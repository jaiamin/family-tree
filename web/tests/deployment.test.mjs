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
