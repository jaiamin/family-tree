import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { localRuntime } from "../scripts/server.mjs";
import { runtime as workerRuntime } from "../scripts/runtime.mjs";
import { build } from "esbuild";

await build({ entryPoints: ["src/backup.ts", "src/recovery.ts", "src/backup-export.ts", "src/gedcom-import.ts", "src/legacy-migration.ts"].map(path => new URL(`../${path}`,import.meta.url).pathname),
  bundle:true, format:"esm", platform:"node", outdir:new URL("../dist/contracts",import.meta.url).pathname });
const { refreshBackup, preUpgradeBackup } = await import("../dist/contracts/backup.js");
const { recoverBackup } = await import("../dist/contracts/recovery.js");
const { encryptedBackup, stageEncryptedBackup } = await import("../dist/contracts/backup-export.js");
const { previewGedcom } = await import("../dist/contracts/gedcom-import.js");
const { migrateLegacy } = await import("../dist/contracts/legacy-migration.js");
const origin="https://family.test",base=`${origin}/family-tree`,password="synthetic-password";
async function installation(kind) {
  if (kind === "Cloudflare") {
    const mf=await workerRuntime({bindings:{PUBLIC_ORIGIN:origin,FAMILY_PASSWORD:password}});
    return {fetch:async request=>mf.dispatchFetch(request.url,{method:request.method,headers:Object.fromEntries(request.headers),body:request.body ? new Uint8Array(await request.arrayBuffer()) : undefined}), env:{OWNER_EMAIL:"owner@example.com",FAMILY_PASSWORD:password,DB:await mf.getD1Database("DB"),PHOTOS:await mf.getR2Bucket("PHOTOS"),BACKUP:await mf.getR2Bucket("BACKUP")},close:()=>mf.dispose()};
  }
  const directory=await mkdtemp(`${tmpdir()}/family-contract-`);
  const local=await localRuntime({directory,origin,familyPassword:password,ownerEmail:"owner@example.com",initialize:true});
  return {...local,close:async()=>{await local.close();await rm(directory,{recursive:true,force:true});}};
}
function client(runtime) {
  let cookie="";
  return {get cookie(){return cookie;},set cookie(value){cookie=value;},async call(path,body,method=body===undefined?"GET":"POST") {
    const response=await runtime.fetch(new Request(`${base}/api${path}`,{method,headers:{origin,...cookie?{cookie}:{},...body===undefined?{}:{"content-type":"application/json"}},body:body===undefined?undefined:JSON.stringify(body)}));
    const jar = new Map(cookie.split("; ").filter(Boolean).map(pair => pair.split("=")));
    for (const header of response.headers.getSetCookie()) {
      const [name,value] = header.split(";")[0].split("=");
      if (value) jar.set(name,value); else jar.delete(name);
    }
    cookie = [...jar].map(([name,value])=>`${name}=${value}`).join("; ");
    return response;
  }};
}
async function ownerSession(runtime, owner) {
  const id = crypto.randomUUID(), token = crypto.randomUUID();
  await runtime.env.DB.prepare("INSERT INTO users(id,email,name,role) VALUES(?,'owner@example.com','Owner','owner')").bind(id).run();
  await runtime.env.DB.prepare("INSERT INTO sessions(token_hash,user_id,auth_version,expires) VALUES(?,?,1,?)").bind(createHash("sha256").update(token).digest("hex"),id,Math.floor(Date.now()/1000)+3600).run();
  owner.cookie = `family_session=${token}`;
}
for(const kind of ["Cloudflare","Local"]) {
  test(`${kind}: shared access needs no account, allows suggestions and rejects edits`,async()=>{
    const runtime=await installation(kind),owner=client(runtime),viewer=client(runtime);
    try {
      assert.equal((await viewer.call("/view")).status,401);
      assert.equal((await viewer.call("/login",{password:"wrong"})).status,403);
      assert.equal((await viewer.call("/login",{password})).status,200);
      assert.equal((await runtime.env.DB.prepare("SELECT count(*) AS n FROM users").first()).n,0);
      assert.equal((await viewer.call("/users")).status,403);
      assert.equal((await viewer.call("/trees",{name:"Denied",revision:0})).status,403);
      assert.equal((await viewer.call("/suggestions",{name:"Relative",message:"Check a date"})).status,201);
      await ownerSession(runtime,owner);
      const tree=await(await owner.call("/trees",{name:"Family",revision:0})).json();
      const person=await(await owner.call("/first-person",{treeId:tree.id,revision:tree.revision,fields:{name:"Relative"}})).json();
      const edits=await Promise.all(["Changed","Other change"].map(name=>owner.call(`/people/${person.id}`,{revision:person.revision,fields:{name}},"PATCH")));
      assert.deepEqual(edits.map(response=>response.status).sort(),[200,409]);
      const signedOut=await viewer.call("/logout",{});assert.equal(signedOut.status,200);
      assert.equal(signedOut.headers.getSetCookie().length,2);
      assert.equal((await viewer.call("/view")).status,401);
    }finally{await runtime.close();}
  });
  test(`${kind}: legacy rehearsal preserves shared IDs and retained photos without changing source`, async () => {
    const source=await installation(kind), target=await installation(kind), owner=client(source);
    try {
      await ownerSession(source,owner);
      const tree=await(await owner.call("/trees",{name:"First",revision:0})).json();
      const person=await(await owner.call("/first-person",{treeId:tree.id,revision:tree.revision,fields:{name:"Shared relative",sex:"female"}})).json();
      const snapshot=await(await owner.call("/collection")).json();
      const second=crypto.randomUUID();snapshot.collection.trees[second]={id:second,name:"Second",members:[person.id]};
      assert.equal((await owner.call("/collection",snapshot,"PUT")).status,200);
      const bytes=new Uint8Array([255,216,255,224,1,2]);
      assert.equal((await source.fetch(new Request(`${base}/api/photos/${person.id}`,{method:"PUT",headers:{cookie:owner.cookie,origin,"content-type":"image/jpeg"},body:bytes}))).status,200);
      await source.env.DB.prepare("CREATE TABLE editors(email TEXT PRIMARY KEY)").run();
      await source.env.DB.prepare("INSERT INTO editors VALUES(?)").bind("relative@example.test").run();
      const original=await(await owner.call("/collection")).json();
      const result=await migrateLegacy(source.env,target.env);
      assert.equal(result.people,1);assert.equal(result.trees,2);assert.equal(result.photos,1);assert.equal(result.approvedEditors,1);
      assert.deepEqual(await(await owner.call("/collection")).json(),original);
      assert.equal((await target.env.DB.prepare("SELECT count(*) AS n FROM tree_members WHERE person_id=?").bind(person.id).first()).n,2);
      const before=(await source.env.DB.prepare("SELECT * FROM public_ids ORDER BY short_id").all()).results;
      assert.deepEqual((await target.env.DB.prepare("SELECT * FROM public_ids ORDER BY short_id").all()).results,before);
      const pending=await target.env.DB.prepare("SELECT enabled,role FROM users").first();assert.equal(pending.enabled,1);assert.equal(pending.role,"editor");
      const nextOwner=client(target);
      await ownerSession(target,nextOwner);
      const restored=await(await nextOwner.call("/collection")).json();assert.deepEqual(restored.collection,original.collection);
      await assert.rejects(migrateLegacy(source.env,target.env),/fresh destination/);
    } finally {await source.close();await target.close();}
  });
  test(`${kind}: maintenance blocks in-flight writes at the database boundary`, async () => {
    const runtime=await installation(kind), owner=client(runtime);
    try {
      await ownerSession(runtime,owner);
      const tree=await(await owner.call("/trees",{name:"Family",revision:0})).json();
      await runtime.env.DB.prepare("UPDATE schema_version SET maintenance=1 WHERE id=1").run();
      assert.equal((await owner.call("/view")).status,503);
      await assert.rejects(runtime.env.DB.prepare("UPDATE trees SET name='Changed' WHERE id=?").bind(tree.id).run(),/installation_paused/);
      await assert.rejects(runtime.env.DB.prepare("INSERT INTO users(id,email,name,role) VALUES('bad','intruder@example.com','Intruder','editor')").run(),/installation_paused/);
      await preUpgradeBackup(runtime.env);
      assert.ok(await runtime.env.BACKUP.head("pre-upgrade.json"));
      await runtime.env.DB.prepare("UPDATE schema_version SET maintenance=0 WHERE id=1").run();
      assert.equal((await owner.call("/view")).status,200);
      assert.equal((await runtime.env.DB.prepare("SELECT name FROM trees").first()).name,"Family");
      await runtime.env.DB.prepare("UPDATE schema_version SET version=999 WHERE id=1").run();
      assert.equal((await owner.call("/view")).status,503);
    } finally {await runtime.close();}
  });
  test(`${kind}: retained photos, cross-runtime encrypted portability and daily recovery`,async()=>{
    const source=await installation(kind),target=await installation(kind === "Cloudflare" ? "Local" : "Cloudflare"),owner=client(source);
    try{
      await ownerSession(source,owner);
      const tree=await(await owner.call("/trees",{name:"Family",revision:0})).json();
      const person=await(await owner.call("/first-person",{treeId:tree.id,revision:tree.revision,fields:{name:"Relative"}})).json();
      const image=new Uint8Array([255,216,255,224,1,2]);
      for(let i=0;i<2;i++)assert.equal((await source.fetch(new Request(`${base}/api/photos/${person.id}`,{method:"PUT",headers:{cookie:owner.cookie,origin,"content-type":"image/jpeg"},body:image}))).status,200);
      await source.env.DB.prepare("UPDATE collections SET updated_at='2001-02-03 04:05:06' WHERE id='main'").run();
      await refreshBackup(source.env);
      await source.env.DB.prepare("UPDATE schema_version SET maintenance=1 WHERE id=1").run();
      await preUpgradeBackup(source.env);
      const previousPoint=await(await source.env.BACKUP.get("pre-upgrade.json")).arrayBuffer();
      const backup=source.env.BACKUP;
      const invalidStage={...source.env,BACKUP:{
        get:key=>key === "pre-upgrade.candidate.json" ? Promise.resolve(new Response("corrupt staging bytes")) : backup.get(key),
        put:(...args)=>backup.put(...args),delete:key=>backup.delete(key),
      }};
      await assert.rejects(preUpgradeBackup(invalidStage),/verification failed/);
      assert.deepEqual(await(await backup.get("pre-upgrade.json")).arrayBuffer(),previousPoint,"failed verification preserves the last recovery point");
      for(const key of ["pre-upgrade.json",`daily/${new Date().toISOString().slice(0,10)}.json`]) {
        const fresh=await installation(kind);
        try {assert.deepEqual(await recoverBackup({...fresh.env,BACKUP:backup},key),{people:1,photos:2});}
        finally {await fresh.close();}
      }
      await source.env.DB.prepare("UPDATE schema_version SET maintenance=0 WHERE id=1").run();
      assert.equal((await source.env.DB.prepare("SELECT error FROM backup_state").first()).error,null);
      const snapshots=(await source.env.BACKUP.list()).objects.map(object=>object.key);
      assert.ok(snapshots.includes("pre-upgrade.json"));assert.ok(snapshots.some(key=>key.startsWith("daily/")));
      const key=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
      const wrongKey=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
      await assert.rejects(stageEncryptedBackup(target.env,await encryptedBackup(source.env,key),wrongKey));
      const encrypted=await encryptedBackup(source.env,key);
      await stageEncryptedBackup(target.env,encrypted,key);
      assert.deepEqual(await recoverBackup(target.env),{people:1,photos:2});
      assert.equal((await target.env.DB.prepare("SELECT count(*) AS n FROM sessions").first()).n,0);
      assert.equal((await target.env.DB.prepare("SELECT count(*) AS n FROM automation_credentials").first()).n,0);
      assert.equal((await target.env.DB.prepare("SELECT count(*) AS n FROM photo_uploads").first()).n,2);
      assert.equal((await target.env.DB.prepare("SELECT name FROM people").first()).name,"Relative");
      for (const table of ["collections","people","trees","tree_members","parents","partnerships","public_ids","photos","photo_uploads","users"]) {
        const rows=async env=>(await env.DB.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results.map(row=>({...row}));
        assert.deepEqual(await rows(target.env),await rows(source.env),`${kind}: ${table} survives changing deployment`);
      }
      for (const upload of (await target.env.DB.prepare("SELECT object_key FROM photo_uploads").all()).results) {
        assert.deepEqual(new Uint8Array(await(await target.env.PHOTOS.get(upload.object_key)).arrayBuffer()),image);
        assert.deepEqual(new Uint8Array(await(await target.env.BACKUP.get(upload.object_key)).arrayBuffer()),image);
      }
      await assert.rejects(recoverBackup(target.env),/empty database/);
    }finally{await source.close();await target.close();}
  });
}
test("GEDCOM preview validates relationships without implicit name merging",async()=>{
  const source="0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME Same Name\n0 @I2@ INDI\n1 NAME Same Name\n0 @F1@ FAM\n1 HUSB @I1@\n1 CHIL @I2@\n0 TRLR\n";
  const draft=await previewGedcom(source,"Imported");assert.equal(draft.people,2);
  const people=Object.values(draft.collection.people);assert.notEqual(people[0].id,people[1].id);assert.deepEqual(people[1].parents,[people[0].id]);
  await assert.rejects(previewGedcom(source.replace("1 CHIL @I2@","1 CHIL @missing@"),"Broken"),/Unresolved/);
  const extra=await previewGedcom(source.replace("1 NAME Same Name","1 NAME Same Name\n1 OCCU Researcher"),"Warnings");assert.ok(extra.warnings.some(warning=>warning.includes("OCCU")));
});

test("GEDCOM preview reports omitted event fields and preserves free-text partnership dates", async () => {
  const source="0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME First\n1 DEAT\n2 PLAC Unmodeled place\n0 @I2@ INDI\n1 NAME Second\n0 @F1@ FAM\n1 HUSB @I1@\n1 WIFE @I2@\n1 MARR\n2 NOTE Date: Around spring 1980\n0 TRLR\n";
  const draft=await previewGedcom(source,"Imported");
  assert.ok(draft.warnings.some(warning=>warning.includes("DEAT.PLAC")));
  assert.equal(Object.values(draft.collection.partnerships)[0].marriage_date,"Around spring 1980");
});
