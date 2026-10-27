import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { localRuntime } from "./scripts/server.mjs";
import { encryptedBackup, stageEncryptedBackup } from "./dist/maintenance/backup-export.js";
import { recoverBackup } from "./dist/maintenance/recovery.js";
let cookie="";
async function call(path,body,method=body===undefined?"GET":"POST") {
  const response=await fetch(`http://localhost:8000/family-tree/api${path}`,{method,headers:{origin:"https://family.test",cookie,"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
  if(response.headers.has("set-cookie"))cookie=response.headers.get("set-cookie").split(";")[0];
  return response;
}
let ready=false;for(let i=0;i<40;i++){try{await call("/session");ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
assert.ok(ready);
assert.equal((await call("/view")).status,401);
// Seed only synthetic privileged data. Google verification is covered by API tests.
const fixture=await localRuntime({directory:"/data",backupDirectory:"/backup",origin:"https://family.test"});
await fixture.env.DB.prepare("INSERT INTO users(id,email,name,role) VALUES('docker-owner','owner@example.com','Owner','owner')").run();
await fixture.env.DB.prepare("INSERT INTO sessions(token_hash,user_id,auth_version,expires) VALUES(?,'docker-owner',1,?)")
  .bind(createHash("sha256").update("synthetic-owner-session").digest("hex"),Math.floor(Date.now()/1000)+3600).run();
await fixture.close();cookie="family_session=synthetic-owner-session";
const tree=await(await call("/trees",{name:"Family",revision:0})).json();
const person=await(await call("/first-person",{treeId:tree.id,revision:tree.revision,fields:{name:"Relative"}})).json();
const ownerCookie=cookie;
cookie="";
assert.equal((await call("/login",{password:"synthetic-password"})).status,200);
assert.equal((await call("/people")).status,403);
const bytes=new Uint8Array([255,216,255,224,1,2]);
assert.equal((await fetch(`http://localhost:8000/family-tree/api/photos/${person.id}`,{method:"PUT",headers:{cookie,origin:"https://family.test","content-type":"image/jpeg"},body:bytes})).status,200);
assert.equal((await call("/suggestions",{name:"Relative",message:"Check the name"})).status,201);
cookie=ownerCookie;
assert.equal((await call(`/photos/${person.id}`,undefined,"DELETE")).status,200);
const source=await localRuntime({directory:"/data",backupDirectory:"/backup",origin:"https://family.test"});
const target=await localRuntime({directory:"/tmp/restore-data",backupDirectory:"/tmp/restore-backup",origin:"https://family.test",initialize:true});
try {
  const key=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
  await stageEncryptedBackup(target.env,await encryptedBackup(source.env,key),key);
  assert.deepEqual(await recoverBackup(target.env),{people:1,photos:1});
  assert.equal((await target.env.DB.prepare("SELECT count(*) AS n FROM sessions").first()).n,0);
  assert.equal((await target.env.DB.prepare("SELECT count(*) AS n FROM photo_uploads").first()).n,1);
} finally {await source.close();await target.close();}

// The HTTPS proxy appends the actual peer after any forged client prefix.
const loginFrom = address => fetch("http://localhost:8000/family-tree/api/login", {
  method:"POST", headers:{origin:"https://family.test","content-type":"application/json","x-forwarded-for":`203.0.113.99, ${address}`},
  body:JSON.stringify({password:"wrong-password"}),
});
for(let i=0;i<10;i++) assert.equal((await loginFrom("198.51.100.1")).status,403);
assert.equal((await loginFrom("198.51.100.1")).status,429);
assert.equal((await loginFrom("198.51.100.2")).status,403,"another relative has an independent login limit");
