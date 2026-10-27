import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { runtime } from "../scripts/runtime.mjs";
await build({ entryPoints: [new URL("../src/recovery.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "node", outfile: new URL("../dist/recovery.mjs", import.meta.url).pathname });
const { recoverBackup } = await import("../dist/recovery.mjs");
test("rolling backup restores records and all original photos into fresh storage, and refuses live data", async () => {
  const source = await runtime(), target = await runtime();
  try {
    const headers = { authorization: "Bearer local-test-owner-token", "content-type": "application/json" };
    const id = crypto.randomUUID(), tree = crypto.randomUUID();
    const collection = { version: 1, site: null, people: { [id]: { id, name: "Relative", parents: [], partners: [] } }, partnerships: {}, trees: { [tree]: { id: tree, name: "Family", members: [id] } } };
    assert.equal((await source.dispatchFetch("http://localhost/family-tree/api/collection", { method: "PUT", headers, body: JSON.stringify({ collection, revision: 0 }) })).status, 200);
    for (let n = 0; n < 2; n++) assert.equal((await source.dispatchFetch(`http://localhost/family-tree/api/photos/${id}`, { method: "PUT", headers: { authorization: headers.authorization, "content-type": "image/jpeg" }, body: new Uint8Array([255,216,255,224,n]) })).status, 200);
    const backup = await source.getR2Bucket("BACKUP");
    let snapshot;
    for (let n = 0; n < 100; n++) {
      const object = await backup.get("collection.json");
      if (object) { snapshot = await object.json(); if (snapshot.uploads.length === 2) break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(snapshot.uploads.length, 2);
    const db = await target.getD1Database("DB"), photos = await target.getR2Bucket("PHOTOS");
    await db.exec("DELETE FROM editors");
    const env = { DB: db, PHOTOS: photos, BACKUP: backup };
    assert.deepEqual(await recoverBackup(env), { people: 1, photos: 2 });
    assert.equal((await db.prepare("SELECT name FROM people WHERE id = ?").bind(id).first()).name, "Relative");
    assert.equal((await db.prepare("SELECT count(*) AS n FROM photo_uploads").first()).n, 2);
    for (const file of snapshot.uploads) {
      assert.deepEqual(new Uint8Array(await (await photos.get(file.object_key)).arrayBuffer()), new Uint8Array(await (await backup.get(file.object_key)).arrayBuffer()));
    }
    await assert.rejects(recoverBackup(env), /empty database/);
    assert.ok(await backup.get("collection.json"), "Recovery must preserve the backup");
  } finally { await source.dispose(); await target.dispose(); }
});

await build({ entryPoints: [new URL("../src/backup.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "node", outfile: new URL("../dist/backup.mjs", import.meta.url).pathname });
const { refreshBackup } = await import("../dist/backup.mjs");
test("backup failures remain visible and a retry clears them without retaining extra snapshots", async () => {
  const mf = await runtime();
  try {
    const DB = await mf.getD1Database("DB"), BACKUP = await mf.getR2Bucket("BACKUP");
    const failed = { head: async () => { throw new Error("Storage unavailable"); } };
    await refreshBackup({ DB, BACKUP: failed });
    assert.match((await DB.prepare("SELECT error FROM backup_state").first()).error, /pending/);
    await refreshBackup({ DB, BACKUP });
    let state = await DB.prepare("SELECT * FROM backup_state").first();
    assert.equal(state.error, null); assert.equal(state.generation, state.saved_generation);
    await DB.exec("UPDATE backup_state SET saved_generation = 0, error = 'Previous interruption'");
    await refreshBackup({ DB, BACKUP });
    state = await DB.prepare("SELECT * FROM backup_state").first();
    assert.equal(state.error, null); assert.equal(state.generation, state.saved_generation, "An already-written backup reconciles status after an interrupted acknowledgement");
    assert.deepEqual((await BACKUP.list()).objects.map(o => o.key), ["collection.json"]);
  } finally { await mf.dispose(); }
});
