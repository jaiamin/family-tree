import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { localRuntime } from "../scripts/server.mjs";
import { runtime as workerRuntime } from "../scripts/runtime.mjs";
import { build } from "esbuild";

await build({ entryPoints: ["src/backup.ts", "src/recovery.ts", "src/backup-export.ts", "src/gedcom-import.ts", "src/legacy-migration.ts", "src/accounts/routes.ts"].map(path => new URL(`../${path}`,import.meta.url).pathname),
  bundle:true, format:"esm", platform:"node", outdir:new URL("../dist/contracts",import.meta.url).pathname });
const { refreshBackup, preUpgradeBackup } = await import("../dist/contracts/backup.js");
const { recoverBackup } = await import("../dist/contracts/recovery.js");
const { encryptedBackup, stageEncryptedBackup } = await import("../dist/contracts/backup-export.js");
const { previewGedcom } = await import("../dist/contracts/gedcom-import.js");
const { migrateLegacy } = await import("../dist/contracts/legacy-migration.js");
const { accountRoute } = await import("../dist/contracts/accounts/routes.js");
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
      assert.equal((await owner.call("/session")).status,200,"new installs can read their neutral site settings");
      assert.equal((await owner.call("/view")).status,200);
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
  test(`${kind}: legacy rehearsal preserves shared IDs and retained photos without changing source`, async () => {
    const source=await installation(kind), target=await installation(kind), owner=client(source);
    try {
      await owner.call("/setup",{token:"local-setup-only",username:"owner",password});
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
      assert.equal(result.people,1);assert.equal(result.trees,2);assert.equal(result.photos,1);assert.equal(result.pendingAccounts,1);
      assert.deepEqual(await(await owner.call("/collection")).json(),original);
      assert.equal((await target.env.DB.prepare("SELECT count(*) AS n FROM tree_members WHERE person_id=?").bind(person.id).first()).n,2);
      const before=(await source.env.DB.prepare("SELECT * FROM public_ids ORDER BY short_id").all()).results;
      assert.deepEqual((await target.env.DB.prepare("SELECT * FROM public_ids ORDER BY short_id").all()).results,before);
      const pending=await target.env.DB.prepare("SELECT enabled,role FROM users").first();assert.equal(pending.enabled,0);assert.equal(pending.role,"editor");
      const nextOwner=client(target);
      assert.equal((await nextOwner.call("/setup",{token:"local-setup-only",username:"new-owner",password})).status,201);
      const restored=await(await nextOwner.call("/collection")).json();assert.deepEqual(restored.collection,original.collection);
      await assert.rejects(migrateLegacy(source.env,target.env),/fresh destination/);
    } finally {await source.close();await target.close();}
  });
  test(`${kind}: maintenance blocks in-flight writes at the database boundary`, async () => {
    const runtime=await installation(kind), owner=client(runtime);
    try {
      await owner.call("/setup",{token:"local-setup-only",username:"owner",password});
      const tree=await(await owner.call("/trees",{name:"Family",revision:0})).json();
      await runtime.env.DB.prepare("UPDATE schema_version SET maintenance=1 WHERE id=1").run();
      assert.equal((await owner.call("/view")).status,503);
      await assert.rejects(runtime.env.DB.prepare("UPDATE trees SET name='Changed' WHERE id=?").bind(tree.id).run(),/installation_paused/);
      await assert.rejects(runtime.env.DB.prepare("INSERT INTO users(id,username,name,role,password_hash) VALUES('bad','intruder','Intruder','viewer','bad')").run(),/installation_paused/);
      await preUpgradeBackup(runtime.env);
      assert.ok(await runtime.env.BACKUP.head("pre-upgrade.json"));
      await runtime.env.DB.prepare("UPDATE schema_version SET maintenance=0 WHERE id=1").run();
      assert.equal((await owner.call("/view")).status,200);
      assert.equal((await runtime.env.DB.prepare("SELECT name FROM trees").first()).name,"Family");
      await runtime.env.DB.prepare("UPDATE schema_version SET version=999 WHERE id=1").run();
      assert.equal((await owner.call("/view")).status,503);
    } finally {await runtime.close();}
  });
  test(`${kind}: ownership target revoked between validation and transaction stays safe`, async () => {
    const runtime=await installation(kind), owner=client(runtime), relative=client(runtime);
    try {
      await owner.call("/setup",{token:"local-setup-only",username:"owner",password});
      const invitation=await(await owner.call("/invitations",{role:"editor"})).json();
      await relative.call("/join",{token:invitation.token,username:"relative",password});
      await owner.call("/automation",{name:"Preserved client"});
      const users=await(await owner.call("/users")).json(), target=users.find(user=>user.username==="relative"), actor=users.find(user=>user.role==="owner");
      const DB=runtime.env.DB;
      const guarded={...runtime.env,DB:{batch:statements=>DB.batch(statements),prepare(sql){
        const statement=DB.prepare(sql);
        if(sql === "SELECT id FROM users WHERE id=? AND enabled=1 AND role!='owner'") return {bind(...values){const bound=statement.bind(...values);return {async first(){const result=await bound.first();await DB.prepare("UPDATE users SET enabled=0 WHERE id=?").bind(target.id).run();return result;}};}};
        return statement;
      }}};
      await assert.rejects(accountRoute(new Request(`${base}/api/ownership`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({userId:target.id,password})}),guarded,actor,"/api/ownership"),/target account changed/);
      assert.equal((await DB.prepare("SELECT count(*) AS n FROM users WHERE role='owner'").first()).n,1);
      assert.equal((await DB.prepare("SELECT role FROM users WHERE id=?").bind(actor.id).first()).role,"owner");
      assert.equal((await DB.prepare("SELECT count(*) AS n FROM automation_credentials").first()).n,1);
    } finally {await runtime.close();}
  });
  test(`${kind}: ownership transfer invalidates reset links and preserves the sole owner`, async () => {
    const runtime = await installation(kind), owner = client(runtime), relative = client(runtime);
    try {
      await owner.call("/setup", {token:"local-setup-only",username:"owner",name:"Owner",password});
      const invitation = await (await owner.call("/invitations", {role:"editor"})).json();
      await relative.call("/join", {token:invitation.token,username:"relative",name:"Relative",password});
      const users = await (await owner.call("/users")).json();
      const target = users.find(user => user.username === "relative");
      const reset = await (await owner.call("/invitations", {role:"editor",targetId:target.id})).json();
      const access = await (await owner.call("/automation", {name:"Test client"})).json();
      assert.ok(access.token);
      await owner.call(`/users/${target.id}`, {role:"editor",enabled:false}, "PATCH");
      assert.equal((await owner.call("/ownership", {userId:target.id,password})).status,400);
      assert.equal((await owner.call("/automation")).status,200);
      assert.equal((await (await owner.call("/automation")).json()).length,1,"failed transfer preserves credentials");
      await owner.call(`/users/${target.id}`, {role:"editor",enabled:true}, "PATCH");
      assert.equal((await relative.call("/join", {token:reset.token,username:"relative",password})).status,409,"role changes invalidate reset links");
      const freshReset = await (await owner.call("/invitations", {role:"editor",targetId:target.id})).json();
      const transfer = await owner.call("/ownership", {userId:target.id,password});
      assert.equal(transfer.status,200,await transfer.clone().text());
      assert.ok((await transfer.json()).recoveryCode);
      assert.equal((await relative.call("/join", {token:freshReset.token,username:"relative",password})).status,403,"old reset cannot take over the new owner");
      assert.equal((await owner.call("/view")).status,401);
      assert.equal((await relative.call("/login", {username:"relative",password})).status,200);
      const owners = await runtime.env.DB.prepare("SELECT count(*) AS n FROM users WHERE role='owner'").first();
      assert.equal(owners.n,1);
      assert.equal((await (await relative.call("/automation")).json()).length,0);
    } finally { await runtime.close(); }
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
      const wrongKey=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
      await assert.rejects(stageEncryptedBackup(target.env,await encryptedBackup(source.env,key),wrongKey));
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
