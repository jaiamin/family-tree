import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
await build({entryPoints:['src/gedcom-import.ts'].map(p=>new URL(`../${p}`,import.meta.url).pathname),bundle:true,format:'esm',platform:'node',outfile:new URL('../dist/import-tests/importer.mjs',import.meta.url).pathname});
const {previewGedcom}=await import('../dist/import-tests/importer.mjs');
const document=(records,{version='5.5.1',encoding='UTF-8',eol='\n'}={})=>`0 HEAD\n1 GEDC\n2 VERS ${version}\n1 CHAR ${encoding}\n${records}\n0 TRLR\n`.replaceAll('\n',eol);
const individual='0 @I1@ INDI\n1 NAME Synthetic /Person/';
const people=draft=>Object.values(draft.collection.people);

for(const version of ['5.5','5.5.1','5.5.5','7.0']) for(const eol of ['\n','\r\n','\r']) {
 test(`imports GEDCOM ${version} with ${JSON.stringify(eol)} line endings`,async()=>{
  const result=await previewGedcom(document(individual,{version,eol}),'Synthetic');
  assert.equal(people(result)[0].name,'Synthetic Person'); assert.equal(result.version,version);
 });
}
for(const endian of ['LE','BE']) for(const bom of [true,false]) {
 test(`decodes UTF-16${endian} ${bom?'with':'without'} a BOM from original bytes`,async()=>{
  let bytes=Buffer.from(document(individual.replace('Synthetic','Zoë'),{encoding:'UNICODE'}),'utf16le');
  if(endian==='BE') bytes=Buffer.from(bytes).swap16();
  if(bom) bytes=Buffer.concat([Buffer.from(endian==='LE'?[255,254]:[254,255]),bytes]);
  const result=await previewGedcom(bytes,'Unicode');
  assert.equal(people(result)[0].name,'Zoë Person'); assert.equal(result.encoding,`UTF-16${endian}`);
 });
}
test('decodes ANSI and ANSEL names, including stacked ANSEL accents',async()=>{
 const ansi=Buffer.from(document(individual.replace('Synthetic','René'),{encoding:'ANSI'}),'latin1');
 assert.equal(people(await previewGedcom(ansi,'ANSI'))[0].name,'René Person');
 const ansel=Buffer.from(document(individual.replace('Synthetic','Jos\xe2e \xe2\xe8U'),{encoding:'ANSEL'}),'latin1');
 assert.equal(people(await previewGedcom(ansel,'ANSEL'))[0].name,'José Ǘ Person');
});
test('does not corrupt already-decoded API text carrying a legacy declaration',async()=>{
 const result=await previewGedcom(document(individual.replace('Synthetic','René'),{encoding:'ANSI'}),'Text API');
 assert.equal(people(result)[0].name,'René Person');
});
test('rejects invalid UTF-8 and unknown encodings without replacement characters',async()=>{
 await assert.rejects(previewGedcom(Buffer.concat([Buffer.from(document(individual)),Buffer.from([255])]),'Bad'),/UTF-8/);
 await assert.rejects(previewGedcom(Buffer.from(document(individual,{encoding:'UNSUPPORTED'})),'Bad'),/encoding/i);
 await assert.rejects(previewGedcom(Buffer.from(document(individual,{version:'7.0',encoding:'ANSI'}),'latin1'),'Bad'),/7.*UTF-8/);
});
test('imports unnamed people and separate records without implicit merging',async()=>{
 const result=await previewGedcom(document('0 @I1@ INDI\n0 @I2@ INDI\n1 NAME //'),'Unnamed');
 assert.deepEqual(people(result).map(p=>p.name),['Unknown','Unknown']);
 assert.notEqual(people(result)[0].id,people(result)[1].id);
 assert.equal(result.statistics.unnamedPeople,2); assert.ok(result.warnings.some(w=>/unnamed/i.test(w)));
});
for(const [version,tag] of [['5.5.1','NOTE'],['7.0','SNOTE']]) {
 test(`resolves shared ${tag} content and continuations`,async()=>{
  const source=document(`${individual}\n1 ${tag} @N1@\n0 @N1@ ${tag} First\n1 CONT Second`,{version});
  assert.equal(people(await previewGedcom(source,'Shared'))[0].notes,'First\nSecond');
 });
}
test('rejects dangling and cyclic shared note references',async()=>{
 await assert.rejects(previewGedcom(document(`${individual}\n1 NOTE @missing@`),'Missing'),/note.*reference/i);
 await assert.rejects(previewGedcom(document(`${individual}\n1 NOTE @N1@\n0 @N1@ NOTE @N2@\n0 @N2@ NOTE @N1@`),'Cycle'),/cyclic.*note/i);
});
test('uses version-specific literal-at escaping',async()=>{
 for(const version of ['5.5.1','7.0']) {
  const result=await previewGedcom(document(`${individual}\n1 NOTE @@start middle@@text`,{version}),'At');
  assert.equal(people(result)[0].notes,version==='7.0'?'@start middle@@text':'@start middle@text');
 }
});
const family=`${individual}\n0 @I2@ INDI\n1 NAME Second\n0 @F1@ FAM\n1 HUSB @I1@\n1 WIFE @I2@`;
test('retains unmarried and childless family unions without inventing marriage',async()=>{
 const result=await previewGedcom(document(family),'Union');
 assert.deepEqual(people(result).map(p=>p.partners.length),[1,1]);
 assert.equal(Object.values(result.collection.partnerships)[0].status,'partners');
});
test('imports birth parents and warns instead of flattening adoptive parents',async()=>{
 const source=document(`${family}\n1 CHIL @I3@\n0 @I3@ INDI\n1 FAMC @F1@\n2 PEDI adopted\n1 FAMC @F2@\n2 PEDI birth\n0 @I4@ INDI\n1 NAME Birth parent\n0 @F2@ FAM\n1 HUSB @I4@\n1 CHIL @I3@`);
 const result=await previewGedcom(source,'Adoption');
 const [a,b,child,birth]=people(result);
 assert.deepEqual(child.parents,[birth.id]); assert.equal(a.partners[0],b.id);
 assert.ok(result.warnings.some(w=>/adoptive|adopted/i.test(w)));
 assert.equal(result.statistics.skippedParentLinks,2);
});
test('honors adoption events even when FAMC has no PEDI',async()=>{
 const source=document(`${family}\n1 CHIL @I3@\n0 @I3@ INDI\n1 ADOP\n2 FAMC @F1@\n1 FAMC @F1@`);
 const result=await previewGedcom(source,'Adoption');
 assert.deepEqual(people(result)[2].parents,[]); assert.ok(result.warnings.some(w=>/adopt/i.test(w)));
});
test('resolves individual-side family links and rejects dangling family references',async()=>{
 const source=document(`${individual}\n1 FAMS @F1@\n0 @I2@ INDI\n1 FAMC @F1@\n0 @F1@ FAM`);
 const result=await previewGedcom(source,'One-sided');
 assert.deepEqual(people(result)[1].parents,[people(result)[0].id]);
 await assert.rejects(previewGedcom(document(`${individual}\n1 FAMC @missing@`),'Missing'),/family.*reference/i);
});
test('rejects damaged framing, duplicate IDs, invalid nesting and unsupported versions',async()=>{
 for(const source of [document(individual).replace('0 TRLR',''),document(`${individual}\n${individual}`),document(individual.replace('1 NAME','3 NAME')),document(individual,{version:'9.0'}),'<html>not GEDCOM</html>']) {
  await assert.rejects(previewGedcom(source,'Invalid'));
 }
});
test('bounds warning output while reporting omitted optional data',async()=>{
 const source=document(`${individual}\n${Array.from({length:300},(_,i)=>`1 _CUSTOM${i} ignored`).join('\n')}`);
 const result=await previewGedcom(source,'Warnings');
 assert.ok(result.warnings.length<=101); assert.equal(result.statistics.omittedFields,300);
});

test('imports people but omits ambiguous parent sets exceeding the domain limit',async()=>{
 const result=await previewGedcom(document(`${family}\n1 CHIL @I3@\n0 @I3@ INDI\n1 FAMC @F2@\n0 @I4@ INDI\n1 NAME Other parent\n0 @F2@ FAM\n1 HUSB @I4@`),'Ambiguous');
 assert.equal(result.people,4); assert.deepEqual(people(result)[2].parents,[]);
 assert.equal(result.statistics.skippedParentLinks,3);
 assert.ok(result.warnings.some(w=>/two-parent limit/.test(w)));
});
test('reports unsupported family and event notes rather than silently consuming them',async()=>{
 const result=await previewGedcom(document(`${family}\n1 NOTE Unsupported family note\n1 MARR\n2 NOTE Unsupported event note`),'Omissions');
 assert.ok(result.warnings.some(w=>/FAM.NOTE/.test(w))); assert.ok(result.warnings.some(w=>/MARR.NOTE/.test(w)));
});

test('rejects BOM/declaration conflicts and malformed UTF-16',async()=>{
 const legacy=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(document(individual,{encoding:'ANSI'}))]);
 await assert.rejects(previewGedcom(legacy,'Conflict'),/conflicts/);
 const truncated=Buffer.concat([Buffer.from([255,254]),Buffer.from(document(individual,{encoding:'UNICODE'}),'utf16le'),Buffer.from([0])]);
 await assert.rejects(previewGedcom(truncated,'Truncated'),/UTF-16/);
});
test('rejects a legacy declaration beyond the bounded header rather than misdecoding',async()=>{
 const source=`0 HEAD\n1 NOTE ${'x'.repeat(64000)}\n1 CHAR ANSEL\n${individual}\n0 TRLR\n`;
 await assert.rejects(previewGedcom(Buffer.from(source),'Late declaration'),/too late/);
});
