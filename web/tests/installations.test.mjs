import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { localRuntime } from "../scripts/server.mjs";
import { runtime as workerRuntime } from "../scripts/runtime.mjs";
import { build } from "esbuild";

await build({ entryPoints: ["src/backup.ts", "src/recovery.ts", "src/backup-export.ts", "src/gedcom-import.ts"].map(path => new URL(`../${path}`,import.meta.url).pathname),
  bundle:true, format:"esm", platform:"node", outdir:new URL("../dist/contracts",import.meta.url).pathname });
const { refreshBackup, preUpgradeBackup } = await import("../dist/contracts/backup.js");
const { recoverBackup } = await import("../dist/contracts/recovery.js");
const { encryptedBackup, stageEncryptedBackup } = await import("../dist/contracts/backup-export.js");
const { previewGedcom } = await import("../dist/contracts/gedcom-import.js");
const origin="https://family.test",base=`${origin}/family-tree`,password="synthetic-password";
async function installation(kind) {
  if (kind === "Cloudflare") {
    const mf=await workerRuntime({bindings:{PUBLIC_ORIGIN:origin}});
    return {fetch:async request=>mf.dispatchFetch(request.url,{method:request.method,headers:Object.fromEntries(request.headers),body:request.body ? new Uint8Array(await request.arrayBuffer()) : undefined}), env:{DB:await mf.getD1Database("DB"),PHOTOS:await mf.getR2Bucket("PHOTOS"),BACKUP:await mf.getR2Bucket("BACKUP")},close:()=>mf.dispose()};
  }
  const directory=await mkdtemp(`${tmpdir()}/family-contract-`);
  const local=await localRuntime({directory,origin,setupToken:"local-setup-only",initialize:true});
  return {...local,close:async()=>{await local.close();await rm(directory,{recursive:true,force:true});}};
}
function client(runtime) {
  let cookie="";
  return {get cookie(){return cookie;},set cookie(value){cookie=value;},async call(path,body,method=body===undefined?"GET":"POST") {
    const response=await runtime.fetch(new Request(`${base}/api${path}`,{method,headers:{origin,...cookie?{cookie}:{},...body===undefined?{}:{"content-type":"application/json"}},body:body===undefined?undefined:JSON.stringify(body)}));
    if(response.headers.has("set-cookie"))cookie=response.headers.get("set-cookie").split(";")[0];
    return response;
  }};
}
for(const kind of ["Cloudflare","Local"]) {
  test(`${kind}: private setup, first person, invitations, roles, conflict and recovery`,async()=>{
    const runtime=await installation(kind),owner=client(runtime),viewer=client(runtime);
    try {
      assert.equal((await owner.call("/view")).status,401);
      const setup=await owner.call("/setup",{token:"local-setup-only",username:"owner",name:"Family owner",password});
      assert.equal(setup.status,201,await setup.clone().text());const recovery=(await setup.json()).recoveryCode;
      assert.equal((await viewer.call("/setup",{token:"local-setup-only",username:"intruder",name:"Intruder",password})).status,409);
      const treeResponse=await owner.call("/trees",{name:"Family",revision:0});assert.equal(treeResponse.status,200);
      const tree=await treeResponse.json();
      const personResponse=await owner.call("/first-person",{treeId:tree.id,revision:tree.revision,fields:{name:"First relative"}});assert.equal(personResponse.status,200);
      const person=await personResponse.json();
      const invitation=await (await owner.call("/invitations",{role:"viewer"})).json();
      const join=await viewer.call("/join",{token:invitation.token,username:"relative",name:"Relative",password});assert.equal(join.status,201);
      assert.equal((await viewer.call("/join",{token:invitation.token,username:"replay",name:"Replay",password})).status,403);
      assert.equal((await viewer.call("/people")).status,403);
      assert.equal((await viewer.call(`/people/${person.id}`,{revision:person.revision,fields:{name:"Denied"}},"PATCH")).status,403);
      assert.equal((await viewer.call("/suggestions",{name:"Relative",message:"Check this name"})).status,201);
      const people=await (await owner.call("/users")).json(),relative=people.find(user=>user.username==="relative");
      const oldCookie=viewer.cookie;
      assert.equal((await owner.call(`/users/${relative.id}`,{role:"editor",enabled:true},"PATCH")).status,200);
      assert.equal((await viewer.call("/view")).status,401,"role change invalidates old sessions");
      assert.equal((await viewer.call("/login",{username:"relative",password})).status,200);
      const edits=await Promise.all(["Changed","Other change"].map(name=>viewer.call(`/people/${person.id}`,{revision:person.revision,fields:{name}},"PATCH")));
      assert.deepEqual(edits.map(response=>response.status).sort(),[200,409]);
      const revoked=await owner.call(`/users/${relative.id}`,{role:"editor",enabled:false},"PATCH");assert.equal(revoked.status,200);
      assert.equal((await viewer.call("/view")).status,401);
      const recover=client(runtime),response=await recover.call("/recover",{code:recovery,password:"replacement-password"});
      assert.equal(response.status,200);assert.notEqual((await response.json()).recoveryCode,recovery);
      assert.equal((await owner.call("/view")).status,401);
      assert.equal((await recover.call("/recover",{code:recovery,password})).status,403);
      assert.equal((await recover.call("/activity")).status,200);
      viewer.cookie=oldCookie;assert.equal((await viewer.call("/view")).status,401);
    }finally{await runtime.close();}
  });
  test(`${kind}: retained photos, encrypted portability and daily recovery`,async()=>{
    const source=await installation(kind),target=await installation(kind),owner=client(source);
    try{
      await owner.call("/setup",{token:"local-setup-only",username:"owner",name:"Owner",password});
      const tree=await(await owner.call("/trees",{name:"Family",revision:0})).json();
      const person=await(await owner.call("/first-person",{treeId:tree.id,revision:tree.revision,fields:{name:"Relative"}})).json();
      const image=new Uint8Array([255,216,255,224,1,2]);
      for(let i=0;i<2;i++)assert.equal((await source.fetch(new Request(`${base}/api/photos/${person.id}`,{method:"PUT",headers:{cookie:owner.cookie,origin,"content-type":"image/jpeg"},body:image}))).status,200);
      await refreshBackup(source.env);await preUpgradeBackup(source.env);
      assert.equal((await source.env.DB.prepare("SELECT error FROM backup_state").first()).error,null);
      const snapshots=(await source.env.BACKUP.list()).objects.map(object=>object.key);
      assert.ok(snapshots.includes("pre-upgrade.json"));assert.ok(snapshots.some(key=>key.startsWith("daily/")));
      const key=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
      const encrypted=await encryptedBackup(source.env,key);
      await stageEncryptedBackup(target.env,encrypted,key);
      assert.deepEqual(await recoverBackup(target.env),{people:1,photos:2});
      assert.equal((await target.env.DB.prepare("SELECT count(*) AS n FROM sessions").first()).n,0);
      assert.equal((await target.env.DB.prepare("SELECT count(*) AS n FROM automation_credentials").first()).n,0);
      assert.equal((await target.env.DB.prepare("SELECT count(*) AS n FROM photo_uploads").first()).n,2);
      assert.equal((await target.env.DB.prepare("SELECT name FROM people").first()).name,"Relative");
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
