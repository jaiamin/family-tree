import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { runtime } from "./support.mjs";
import { migratePublicIds, randomShortId, isShortId } from "../dist/public-ids.mjs";

const base = "http://localhost/family-tree";
const owner = { authorization: "Bearer local-test-owner-token", "content-type": "application/json" };
const fixture = () => {
  const [a, b, c, first, second] = Array.from({ length: 5 }, randomUUID);
  return { version: 1, site: null,
    people: { [a]: { id: a, name: "Parent", parents: [], partners: [b] }, [b]: { id: b, name: "Partner", parents: [], partners: [a] }, [c]: { id: c, name: "Child", parents: [a,b], partners: [] } },
    partnerships: {}, trees: { [first]: { id: first, name: "First", members: [a,b,c] }, [second]: { id: second, name: "Second", members: [c] } } };
};
async function setup() {
  const mf = await runtime(), DB = await mf.getD1Database("DB");
  const call = (path, body, method = body === undefined ? "GET" : "PUT") => mf.dispatchFetch(`${base}/api${path}`, { method, headers: owner, body: body === undefined ? undefined : JSON.stringify(body) });
  const collection = fixture();
  assert.equal((await call("/collection", { collection, revision: 0 })).status, 200);
  return { mf, DB, call, collection };
}
const mappings = async DB => (await DB.prepare("SELECT * FROM public_ids ORDER BY kind,entity_id").all()).results;

test("public IDs use12 cryptographically random unambiguous characters", () => {
  const ids = Array.from({ length: 2000 }, randomShortId);
  assert.ok(ids.every(isShortId)); assert.equal(new Set(ids).size, ids.length);
  for (const invalid of [randomUUID(), "0OIl00000000", "abc", "../../people", null]) assert.equal(isShortId(invalid), false);
});

test("backfill preserves existing family data and photos, and rerunning preserves every URL", async () => {
  const { mf, DB, call, collection } = await setup();
  try {
    const person = Object.keys(collection.people)[0];
    const upload = await mf.dispatchFetch(`${base}/api/photos/${person}`, { method: "PUT", headers: { authorization: owner.authorization, "content-type": "image/jpeg" }, body: new Uint8Array([255,216,255,224]) });
    assert.equal(upload.status, 200);
    const before = await (await call("/collection")).json();
    const photo = await DB.prepare("SELECT * FROM photos").all();
    // Reproduce a pre-migration populated database, not a re-imported collection.
    await DB.exec("DROP TRIGGER public_person_delete; DROP TRIGGER public_tree_delete; DROP TABLE public_ids;");
    await DB.exec((await readFile(new URL("../migrations/0001_public_ids.sql", import.meta.url), "utf8")).replace(/\n/g," "));
    assert.equal(await migratePublicIds({ DB }), 5);
    const assigned = await mappings(DB);
    assert.equal(await migratePublicIds({ DB }), 0);
    assert.deepEqual(await mappings(DB), assigned);
    assert.deepEqual(await (await call("/collection")).json(), before);
    assert.deepEqual((await DB.prepare("SELECT * FROM photos").all()).results, photo.results);
    assert.equal((await DB.prepare("SELECT count(*) AS n FROM photo_uploads").first()).n, 1);
    const image = await mf.dispatchFetch(`${base}/api/photos/${person}`, { headers: owner });
    assert.deepEqual(new Uint8Array(await image.arrayBuffer()), new Uint8Array([255,216,255,224]));
  } finally { await mf.dispose(); }
});

test("allocation retries candidate collisions and database races without changing existing IDs", async () => {
  const { mf, DB } = await setup();
  try {
    const original = await mappings(DB), existing = original[0];
    const extra = randomUUID();
    await DB.prepare("INSERT INTO people(id,name) VALUES (?,?)").bind(extra,"New person").run();
    const next = randomShortId(); let calls = 0;
    assert.equal(await migratePublicIds({ DB }, () => ++calls === 1 ? existing.short_id : next), 1);
    assert.equal(calls, 2);
    const raced = randomUUID();
    await DB.prepare("INSERT INTO people(id,name) VALUES (?,?)").bind(raced,"Race person").run();
    let reads = 0, candidates = 0;
    const proxy = { prepare(sql) {
      if (sql === "SELECT * FROM public_ids" && reads++ === 0) return { all: async () => ({ results: (await mappings(DB)).map(row => row.short_id === existing.short_id ? { ...row, short_id: randomShortId() } : row) }) };
      return DB.prepare(sql);
    }, batch: (...args) => DB.batch(...args) };
    assert.equal(await migratePublicIds({ DB: proxy }, () => ++candidates === 1 ? existing.short_id : randomShortId()), 1);
    assert.ok(reads >= 2, "A database uniqueness race must retry");
    for (const row of original) assert.deepEqual((await mappings(DB)).find(r => r.kind === row.kind && r.entity_id === row.entity_id), row);
    assert.equal(new Set((await mappings(DB)).map(r => r.short_id)).size, 7);
    await assert.rejects(DB.prepare("UPDATE public_ids SET short_id = ? WHERE entity_id = ?").bind(randomShortId(),extra).run(), /permanent/);
  } finally { await mf.dispose(); }
});

test("short routes require access, UUID routes are gone, and a shared person has one public ID", async () => {
  const { mf, DB, call, collection } = await setup();
  try {
    const rows = await mappings(DB), trees = rows.filter(r => r.kind === "tree");
    const shared = Object.keys(collection.people)[2];
    const a = await (await call(`/view?tree=${trees[0].short_id}`)).json();
    const b = await (await call(`/view?tree=${trees[1].short_id}`)).json();
    assert.equal(a.tree.people[shared].short_id, b.tree.people[shared].short_id);
    assert.equal(a.tree.people[shared].other_trees[0].short_id, b.tree.short_id);
    assert.equal((await call(`/view?tree=${trees[0].entity_id}`)).status, 404);
    assert.equal((await mf.dispatchFetch(`${base}/api/view?tree=${trees[0].short_id}`)).status, 401);
    const login = await mf.dispatchFetch(`${base}/t/${trees[0].short_id}#${a.tree.people[shared].short_id}`);
    assert.match(await login.text(), /family-password/);
    assert.equal(login.headers.get("location"), null);
    for (const headers of [{}, owner]) {
      assert.equal((await mf.dispatchFetch(`${base}/trees/${trees[0].entity_id}`, { headers })).status, 404);
      assert.equal((await mf.dispatchFetch(`${base}/t/${trees[0].entity_id}`, { headers })).status, 404);
    }
    const unknown = randomShortId();
    assert.equal((await mf.dispatchFetch(`${base}/t/${unknown}`, { headers: owner })).status, 404);
    assert.equal((await call(`/view?tree=${unknown}`)).status, 404);
    const page = await mf.dispatchFetch(`${base}/t/${trees[0].short_id}`, { headers: owner });
    assert.equal(page.status, 200); assert.match(page.headers.get("cache-control"), /private, no-store/);
  } finally { await mf.dispose(); }
});

test("concurrent MCP updates create IDs only for committed records and preserve existing links", async () => {
  const { mf, DB, call, collection } = await setup();
  try {
    const original = await mappings(DB), first = structuredClone(collection), second = structuredClone(collection);
    const [a,b] = [randomUUID(), randomUUID()];
    first.people[a] = { id:a, name:"First addition", parents:[], partners:[] };
    second.people[b] = { id:b, name:"Second addition", parents:[], partners:[] };
    const responses = await Promise.all([call("/collection", { collection:first, revision:1 }),call("/collection", { collection:second, revision:1 })]);
    assert.deepEqual(responses.map(r=>r.status).sort(), [200,409]);
    const current = await (await call("/collection")).json(), rows = await mappings(DB);
    assert.equal(rows.length, 6);
    for (const row of rows.filter(r=>r.kind==="person")) assert.ok(current.collection.people[row.entity_id]);
    for (const row of original) assert.deepEqual(rows.find(r=>r.kind===row.kind && r.entity_id===row.entity_id),row);
    const currentId = Object.keys(current.collection.people).find(id=>id===a||id===b);
    delete current.collection.people[currentId];
    assert.equal((await call("/collection", { collection:current.collection, revision:current.revision })).status,200);
    assert.equal((await mappings(DB)).length,5);
  } finally { await mf.dispose(); }
});
