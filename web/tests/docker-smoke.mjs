// Runs the production image without networking. All volumes contain synthetic
// data and are removed in finally; existing containers/volumes are untouched.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
const exec = promisify(execFile), prefix = `family-contract-${process.pid}`;
const image = `${prefix}:local`, data = `${prefix}-data`, backup = `${prefix}-backup`;
const docker = (...args) => exec("docker", args, {maxBuffer: 4 * 1024 * 1024});
const settings = ["--network=none", "--read-only", "--tmpfs=/tmp", "--cap-drop=ALL", "--security-opt=no-new-privileges",
  "-v",`${data}:/data`,"-v",`${backup}:/backup`,"-e","PUBLIC_ORIGIN=https://family.test","-e","SETUP_TOKEN=local-test-claim"];
async function inContainer(source) {
  const child = execFile("docker",["exec","-i",prefix,"node","--input-type=module"],{maxBuffer:1024*1024});
  child.stdin.end(source);
  await new Promise((resolve,reject)=>{child.on("error",reject);child.on("exit",code=>code===0?resolve():reject(Error(`Container contract failed (${code}).`)));});
}
try {
  await docker("build","-t",image,new URL("..",import.meta.url).pathname);
  await docker("volume","create",data); await docker("volume","create",backup);
  await docker("run","--rm",...settings,image,"node","scripts/maintain.mjs","init");
  await docker("run","-d","--name",prefix,...settings,image);
  await inContainer(await readFile(new URL("fixtures/docker-flow.mjs",import.meta.url),"utf8"));
  await docker("restart",prefix);
  await inContainer(`import assert from 'node:assert/strict';
    let response; for(let i=0;i<40;i++){try{response=await fetch('http://localhost:8000/family-tree/api/session');break;}catch{await new Promise(r=>setTimeout(r,100));}}
    assert.equal(response.status,200);assert.equal((await response.json()).needsSetup,false);
    const login=await fetch('http://localhost:8000/family-tree/api/login',{method:'POST',headers:{origin:'https://family.test','content-type':'application/json'},body:JSON.stringify({username:'owner',password:'synthetic-password'})});
    assert.equal(login.status,200);const view=await fetch('http://localhost:8000/family-tree/api/view',{headers:{cookie:login.headers.get('set-cookie').split(';')[0]}});
    assert.equal((await view.json()).trees[0].people,1);`);
  await docker("exec",prefix,"node","scripts/maintain.mjs","pause");
  await docker("exec",prefix,"node","scripts/maintain.mjs","preflight");
  await docker("exec",prefix,"node","scripts/maintain.mjs","resume");
  console.log("Docker: offline setup, roles, tree, photo retention, encrypted recovery, restart and pre-upgrade backup passed.");
} finally {
  await docker("rm","-f",prefix).catch(()=>{});
  await docker("volume","rm",data,backup).catch(()=>{});
  await docker("image","rm",image).catch(()=>{});
}
