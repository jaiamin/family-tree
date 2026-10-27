import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { LocalBlobs } from "../dist/local.mjs";

test("listing recovery points and reading photo metadata never load retained photo bodies", async () => {
  const directory=await mkdtemp(`${tmpdir()}/family-object-contract-`), blobs=new LocalBlobs(directory);
  const filesystem=createRequire(import.meta.url)("node:fs/promises"), original=filesystem.readFile;
  try {
    for(let i=0;i<8;i++) await blobs.put(`people/relative/${i}`,new Uint8Array(512*1024));
    await blobs.put("daily/2026-10-27.json","synthetic snapshot");
    let completeObjectReads=0;
    filesystem.readFile=(...args)=>{completeObjectReads++;return original(...args);};
    syncBuiltinESMExports();
    assert.deepEqual((await blobs.list({prefix:"daily/"})).objects.map(item=>item.key),["daily/2026-10-27.json"]);
    assert.equal((await blobs.head("people/relative/0")).size,512*1024);
    assert.equal(completeObjectReads,0,"metadata operations must not buffer image contents");
    const photo=await blobs.get("people/relative/0");assert.equal((await photo.arrayBuffer()).byteLength,512*1024);
    await assert.rejects(blobs.delete("people/relative/0"),/Immutable uploads/);
  } finally {
    filesystem.readFile=original;syncBuiltinESMExports();
    await rm(directory,{recursive:true,force:true});
  }
});
