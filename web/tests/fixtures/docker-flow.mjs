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
const setup=await call("/setup",{token:"local-test-claim",username:"owner",name:"Owner",password:"synthetic-password"});assert.equal(setup.status,201);
const tree=await(await call("/trees",{name:"Family",revision:0})).json();
const person=await(await call("/first-person",{treeId:tree.id,revision:tree.revision,fields:{name:"Relative"}})).json();
const ownerCookie=cookie;
const invite=await(await call("/invitations",{role:"viewer"})).json();cookie="";
assert.equal((await call("/join",{token:invite.token,username:"relative",name:"Relative",password:"synthetic-password"})).status,201);
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
