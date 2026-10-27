import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePublicSettings } from "../scripts/config.mjs";
import { clientAddress, proxyHops } from "../scripts/proxy.mjs";
import { assertBuiltPath, localRuntime } from "../scripts/server.mjs";

test("both deployment configurations require a canonical origin and base path", () => {
  for (const basePath of ["", "/family-tree", "/a/b"]) validatePublicSettings({publicOrigin:"https://family.example",basePath});
  for (const publicOrigin of [undefined,"http://family.example","https://family.example/","https://family.example/path","https://owner:password@family.example"]) {
    assert.throws(()=>validatePublicSettings({publicOrigin,basePath:"/family-tree"}),/HTTPS origin/);
  }
  for (const basePath of [undefined,"/family-tree/","family-tree","/../private"]) assert.throws(()=>validatePublicSettings({publicOrigin:"https://family.example",basePath}),/basePath/);
});

test("a mismatched frontend path fails before local storage is opened", async () => {
  await assert.rejects(assertBuiltPath("/different"),/Rebuild/);
});

test("maintenance can open storage without the frontend deployment path", async () => {
  const {mkdtemp,rm}=await import("node:fs/promises");
  const {tmpdir}=await import("node:os");
  const directory=await mkdtemp(`${tmpdir()}/family-maintenance-path-`);
  const runtime=await localRuntime({directory,basePath:"/custom",initialize:true});
  try { assert.equal((await runtime.env.DB.prepare("SELECT version FROM schema_version").first()).version,2); }
  finally {await runtime.close();await rm(directory,{recursive:true,force:true});}
});

test("proxy addressing defaults to socket-only and ignores forged or malformed forwarding", () => {
  const peer="172.18.0.1";
  assert.equal(clientAddress(peer,"198.51.100.1"),peer);
  assert.equal(clientAddress(peer,"203.0.113.99, 198.51.100.1",1),"198.51.100.1");
  assert.equal(clientAddress(peer,"203.0.113.99, 198.51.100.2",1),"198.51.100.2");
  assert.equal(clientAddress(peer,"198.51.100.1, 172.18.0.2",2),"198.51.100.1");
  for (const header of [undefined,["198.51.100.1"],"forged","198.51.100.1, forged",""]) assert.equal(clientAddress(peer,header,1),peer);
  assert.equal(clientAddress(peer,"198.51.100.1",2),peer);
  assert.equal(proxyHops(),0); assert.equal(proxyHops("1"),1);
  for (const value of ["true","-1","1.5","10"]) assert.throws(()=>proxyHops(value),/TRUST_PROXY_HOPS/);
});

test("local restart applies password rotation and owner changes without losing family data", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { createHash } = await import("node:crypto");
  const directory = await mkdtemp(`${tmpdir()}/family-access-rotation-`), origin = "https://family.test";
  let app = await localRuntime({directory,origin,initialize:true,familyPassword:"first-shared-secret",ownerEmail:"first@example.com"});
  const call = (path, options = {}) => app.fetch(new Request(`${origin}/family-tree/api${path}`,options));
  try {
    const login = await call("/login",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify({password:"first-shared-secret"})});
    const viewer = login.headers.get("set-cookie").split(";")[0];
    await app.env.DB.prepare("INSERT INTO users(id,email,name,role) VALUES('previous-owner','first@example.com','Owner','owner')").run();
    await app.env.DB.prepare("INSERT INTO sessions(token_hash,user_id,auth_version,expires) VALUES(?,'previous-owner',1,?)")
      .bind(createHash("sha256").update("previous-owner-session").digest("hex"),Math.floor(Date.now()/1000)+3600).run();
    await app.env.DB.prepare("INSERT INTO automation_credentials(id,name,token_hash,user_id) VALUES('previous-token','MCP',?,'previous-owner')")
      .bind(createHash("sha256").update("previous-agent-token").digest("hex")).run();
    const person=crypto.randomUUID();
    await app.env.DB.prepare("INSERT INTO people(id,name) VALUES(?,'Preserved relative')").bind(person).run();
    await app.close();
    app = await localRuntime({directory,origin,familyPassword:"replacement-shared-secret",ownerEmail:"next@example.com"});
    for (const headers of [{cookie:viewer},{cookie:"family_session=previous-owner-session"},{authorization:"Bearer previous-agent-token"}]) {
      assert.equal((await call("/view",{headers})).status,401);
    }
    assert.equal((await call("/login",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify({password:"replacement-shared-secret"})})).status,200);
    assert.equal((await app.env.DB.prepare("SELECT name FROM people WHERE id=?").bind(person).first()).name,"Preserved relative");
  } finally {await app.close();await rm(directory,{recursive:true,force:true});}
});
