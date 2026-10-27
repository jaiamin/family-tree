import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { runtime } from "../scripts/runtime.mjs";

const origin = "http://localhost", base = `${origin}/family-tree`;
const treeId = randomUUID(), emptyTree = randomUUID(), personId = randomUUID();
const owner = { authorization: "Bearer local-test-owner-token" };
let mf, db, cookie, version;
const call = (path, headers = {}) => mf.dispatchFetch(base + path, { headers: { cookie, ...headers } });
const image = new Uint8Array([255, 216, 255, 224, 0, 0]);
const upload = () => mf.dispatchFetch(`${base}/api/photos/${personId}`, { method: "PUT", headers: { cookie, origin, "content-type": "image/jpeg" }, body: image });
before(async () => {
  mf = await runtime(); db = await mf.getD1Database("DB");
  const person = { id: personId, name: "Private relative", parents: [], partners: [] };
  const collection = { version: 1, site: { name: "Test family" }, people: { [personId]: person }, partnerships: {},
    trees: { [treeId]: { id: treeId, name: "Family", members: [personId] }, [emptyTree]: { id: emptyTree, name: "Empty family", members: [] } } };
  const saved = await mf.dispatchFetch(`${base}/api/collection`, { method: "PUT", headers: { ...owner, origin, "content-type": "application/json" }, body: JSON.stringify({ collection, revision: 0 }) });
  assert.equal(saved.status, 200, await saved.text());
  const login = await mf.dispatchFetch(`${base}/api/login`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ password: "local-preview-only" }) });
  cookie = login.headers.get("set-cookie").split(";")[0];
  version = (await (await upload()).json()).v;
});
after(async () => { await mf?.dispose(); });

test("only versioned code is publicly cacheable; HTML and records stay private", async () => {
  for (const route of ["", `/trees/${treeId}`]) {
    const page = await call(route), html = await page.text();
    assert.equal(page.headers.get("cache-control"), "private, no-store");
    assert.ok(!html.includes("Private relative"));
    const scripts = [...html.matchAll(/<script src="([^"]+)"[^>]*defer/g)].map(match => match[1]);
    assert.equal(scripts.length, route ? 3 : 1);
    assert.ok(html.length < 60000, "HTML must not embed the layout engine");
    for (const script of scripts) {
      assert.match(script, /\/assets\/(app|elk|viewer)\.[a-f0-9]{16}\.js$/);
      const response = await mf.dispatchFetch(origin + script);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
      assert.match(response.headers.get("content-type"), /javascript/);
      const head = await mf.dispatchFetch(origin + script, { method: "HEAD" });
      assert.equal(await head.text(), "");
    }
  }
  const missing = await call("/assets/missing.js");
  assert.equal(missing.status, 404); assert.match(missing.headers.get("cache-control"), /no-store/);
  const view = await call(`/api/view?tree=${treeId}`);
  assert.equal(view.headers.get("cache-control"), "private, no-store");
});

test("overview counts include empty trees and photo pointers are scoped to the selected tree", async () => {
  const overview = await (await call("/api/view")).json();
  assert.equal(overview.siteName, "Test family"); assert.equal(overview.tree, null);
  assert.deepEqual(overview.trees.map(t => t.people), [1, 0]);
  const full = await (await call(`/api/view?tree=${treeId}`)).json();
  assert.deepEqual(full.tree.photo_versions, { [personId]: version });
  assert.deepEqual((await (await call(`/api/view?tree=${emptyTree}`)).json()).tree.photo_versions, {});
  assert.equal(full.revision, overview.revision);
  assert.equal((await call(`/api/view?tree=${randomUUID()}`)).status, 404);
});

test("photo revalidation authenticates first and respects replacements, removal and access revocation", async () => {
  const path = `/api/photos/${personId}?v=${version}`;
  const initial = await call(path), etag = initial.headers.get("etag");
  assert.equal(initial.status, 200); assert.match(initial.headers.get("cache-control"), /^private, no-cache$/);
  assert.ok(etag); assert.deepEqual(new Uint8Array(await initial.arrayBuffer()), image);
  for (const tag of [etag, `W/${etag}`, `"other", ${etag}`, "*"]) {
    const fresh = await call(path, { "if-none-match": tag });
    assert.equal(fresh.status, 304); assert.equal(await fresh.text(), "");
  }
  const anonymous = await mf.dispatchFetch(base + path, { headers: { "if-none-match": etag } });
  assert.equal(anonymous.status, 401); assert.match(anonymous.headers.get("cache-control"), /no-store/);
  const next = (await (await upload()).json()).v;
  const replaced = await call(path, { "if-none-match": etag });
  assert.equal(replaced.status, 200); assert.equal(replaced.headers.get("etag"), `"${next}"`);
  const token = randomUUID(), email = "temporary@example.com";
  await db.batch([
    db.prepare("INSERT INTO editors(email) VALUES (?)").bind(email),
    db.prepare("INSERT INTO sessions(token_hash,email,credential,expires) VALUES (?,?,?,?)").bind(createHash("sha256").update(token).digest("hex"), email, "{}", Math.floor(Date.now()/1000)+3600),
  ]);
  const signed = { cookie: `family_session=${token}`, "if-none-match": `"${next}"` };
  assert.equal((await call(path, signed)).status, 304);
  await db.prepare("DELETE FROM editors WHERE email = ?").bind(email).run();
  assert.equal((await call(path, signed)).status, 401);
  const removed = await mf.dispatchFetch(base + path, { method: "DELETE", headers: { ...owner, origin } });
  assert.equal(removed.status, 200);
  const stale = await call(path, { "if-none-match": `"${next}"` });
  assert.equal(stale.status, 404); assert.match(stale.headers.get("cache-control"), /no-store/);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM photo_uploads WHERE person_id = ?").bind(personId).first()).n, 2);
  version = (await (await upload()).json()).v;
});

test("concurrent edits and reads keep revision checks and photo pointers consistent", async () => {
  const { revision } = await (await call("/api/view")).json();
  const attempts = Array.from({ length: 12 }, (_, i) => mf.dispatchFetch(`${base}/api/people/${personId}`, {
    method: "PATCH", headers: { ...owner, origin, "content-type": "application/json" }, body: JSON.stringify({ revision, fields: { name: `Edit ${i}` } }),
  }));
  const readers = Array.from({ length: 12 }, () => call(`/api/view?tree=${treeId}`));
  const [edits, reads] = await Promise.all([Promise.all(attempts), Promise.all(readers)]);
  assert.equal(edits.filter(r => r.status === 200).length, 1);
  assert.equal(edits.filter(r => r.status === 409).length, 11);
  for (const response of reads) {
    const view = await response.json();
    assert.ok([revision, revision + 1].includes(view.revision));
    assert.equal(view.tree.people[personId].name === "Private relative", view.revision === revision);
    assert.deepEqual(view.tree.photo_versions, { [personId]: version });
  }
  assert.equal((await (await call("/api/view")).json()).revision, revision + 1);
});

test("minified layout engine preserves the original geometry in both orientations", async () => {
  const { readFile, writeFile } = await import("node:fs/promises");
  const { createRequire } = await import("node:module");
  const vm = await import("node:vm");
  const original = createRequire(import.meta.url)("../ui/vendor/elk.bundled.js");
  const pages = JSON.parse(await readFile(new URL("../generated/pages.json", import.meta.url), "utf8"));
  const engineFile = new URL("../generated/elk-test.cjs", import.meta.url);
  await writeFile(engineFile, Object.entries(pages).find(([path]) => path.startsWith("/assets/elk."))[1]);
  const bundled = createRequire(import.meta.url)(engineFile.pathname);
  const helpers = await readFile(new URL("../ui/layout.js", import.meta.url), "utf8");
  const layoutWith = engine => {
    const context = { module: { exports: {} }, require: () => engine };
    vm.runInNewContext(helpers, context);
    return context.module.exports.layout;
  };
  const family = { people: {
    a: { name: "A", parents: [], partners: ["b"] }, b: { name: "B", parents: [], partners: ["a"] },
    c: { name: "C", parents: ["a", "b"], partners: ["d"] }, d: { name: "D", parents: [], partners: ["c"] },
    e: { name: "E", parents: ["a", "b"], partners: [] }, f: { name: "F", parents: ["c", "d"], partners: [] },
    g: { name: "G", parents: ["e"], partners: [] },
  }, partnerships: {} };
  for (const direction of ["DOWN", "RIGHT"]) {
    const [before, after] = await Promise.all([layoutWith(original)(family, direction), layoutWith(bundled)(family, direction)]);
    assert.deepEqual(JSON.parse(JSON.stringify(after)), JSON.parse(JSON.stringify(before)));
  }
});
