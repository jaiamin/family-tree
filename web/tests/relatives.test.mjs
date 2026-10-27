import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runtime } from "./support.mjs";
const ids = Array.from({ length: 6 }, randomUUID);
const [parent, other, child, third, tree, outsideTree] = ids;
const fixture = () => ({ version: 1, site: null, people: Object.fromEntries([
  [parent, "Parent", [], [other]], [other, "Other parent", [], [parent]], [child, "Existing child", [], []], [third, "Third parent", [], []],
].map(([id, name, parents, partners]) => [id, { id, name, parents, partners }])), partnerships: {},
  trees: { [tree]: { id: tree, name: "Family", members: [parent, child] }, [outsideTree]: { id: outsideTree, name: "Other family", members: [other, third] } } });
async function setup() {
  const mf = await runtime();
  const call = (path, body, method = body === undefined ? "GET" : "POST") => mf.dispatchFetch(`http://localhost/family-tree/api${path}`, {
    method, headers: { authorization: "Bearer local-test-owner-token", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal((await call("/collection", { revision: 0, collection: fixture() }, "PUT")).status, 200);
  return { mf, call };
}
test("adding a new child with an explicit second parent commits both links and membership together", async () => {
  const { mf, call } = await setup();
  try {
    const response = await call("/people", { revision: 1, treeId: tree, relativeId: parent, relation: "child", otherParentId: other, fields: { name: "New child" } });
    assert.equal(response.status, 200, await response.clone().text());
    const { id, revision } = await response.json(); assert.equal(revision, 2);
    const { collection } = await (await call("/collection")).json();
    assert.deepEqual(collection.people[id].parents, [parent, other]);
    assert.ok(collection.trees[tree].members.includes(other));
    assert.equal(Object.keys(collection.people).length, 5);
  } finally { await mf.dispose(); }
});
test("an existing child is reused, and omitting the other parent never assumes the partner", async () => {
  const { mf, call } = await setup();
  try {
    assert.equal((await call("/relationships", { revision: 1, treeId: tree, personId: parent, relativeId: child, relation: "child" })).status, 200);
    let state = await (await call("/collection")).json();
    assert.deepEqual(state.collection.people[child].parents, [parent]);
    assert.equal((await call("/relationships", { revision: 2, treeId: tree, personId: parent, relativeId: child, relation: "child", otherParentId: other })).status, 200);
    state = await (await call("/collection")).json();
    assert.deepEqual(state.collection.people[child].parents, [parent, other]);
    assert.equal(Object.keys(state.collection.people).length, 4);
  } finally { await mf.dispose(); }
});
test("invalid second parents cannot partially add a person or relationship; stale edits stay rejected", async () => {
  const { mf, call } = await setup();
  try {
    for (const otherParentId of [parent, randomUUID()]) {
      const response = await call("/people", { revision: 1, treeId: tree, relativeId: parent, relation: "child", otherParentId, fields: { name: "Must not persist" } });
      assert.equal(response.status, 400);
      const state = await (await call("/collection")).json();
      assert.equal(state.revision, 1); assert.equal(Object.keys(state.collection.people).length, 4);
    }
    assert.equal((await call("/relationships", { revision: 0, treeId: tree, personId: parent, relativeId: child, relation: "child", otherParentId: other })).status, 409);
    assert.equal((await call("/relationships", { revision: 1, treeId: tree, personId: parent, relativeId: child, relation: "child", otherParentId: child })).status, 400);
    const state = await (await call("/collection")).json();
    assert.deepEqual(state.collection.people[child].parents, []);
    const index = await (await call("/people")).json();
    assert.deepEqual(index.find(p => p.id === other).trees, ["Other family"]);
  } finally { await mf.dispose(); }
});

test("choosing an unpartnered other parent does not invent a marriage, and a third parent is rejected atomically", async () => {
  const { mf, call } = await setup();
  try {
    assert.equal((await call("/relationships", { revision: 1, treeId: tree, personId: parent, relativeId: child, relation: "child", otherParentId: third })).status, 200);
    let state = await (await call("/collection")).json();
    assert.deepEqual(state.collection.people[parent].partners, [other]);
    assert.deepEqual(state.collection.people[third].partners, []);
    const response = await call("/relationships", { revision: 2, treeId: tree, personId: other, relativeId: child, relation: "child", otherParentId: third });
    assert.equal(response.status, 400);
    state = await (await call("/collection")).json();
    assert.equal(state.revision, 2);
    assert.deepEqual(state.collection.people[child].parents, [parent, third]);
    assert.ok(!state.collection.trees[tree].members.includes(other));
  } finally { await mf.dispose(); }
});
