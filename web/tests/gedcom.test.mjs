import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runtime } from "../scripts/runtime.mjs";

const origin = "http://localhost", base = `${origin}/family-tree/api`;
const [father, mother, child, partner, single, outside, treeId, otherTree] = Array.from({ length: 8 }, randomUUID);
const notes = "Family memory @ home\n" + "ગુજરાતી 👪 ".repeat(100);
let mf, cookie, text, treeShortId;
const people = Object.fromEntries([
  [father, "Father", "male", [], [mother]], [mother, "Mother", "female", [], [father]],
  [child, "Child", "female", [father, mother], [partner]], [partner, "Partner", "female", [], [child]],
  [single, "Single parent", "female", [], []], [outside, "Private outsider", "male", [], []],
].map(([id, name, sex, parents, partners]) => [id, { id, name, sex, parents, partners }]));
people[father] = { ...people[father], birth_date: "1945-10-24", birth_place: "Anand, Gujarat", death_date: "2020-02", notes };
people[mother].birth_date = "About 1945";
const loneChild = randomUUID();
people[loneChild] = { id: loneChild, name: "Single parent's child", parents: [single, outside], partners: [] };
const members = [father, mother, child, partner, single, loneChild];
const collection = {
  version: 1, site: { name: "Example", url: "" }, people,
  partnerships: { [[father, mother].sort().join("+")]: { status: "married", marriage_date: "1965-06-01" }, [[child, partner].sort().join("+")]: { status: "partners" } },
  trees: { [treeId]: { id: treeId, name: "Example Family", members }, [otherTree]: { id: otherTree, name: "Other family", members: [outside, father] } },
};
before(async () => {
  mf = await runtime();
  const imported = await mf.dispatchFetch(`${base}/collection`, { method: "PUT", headers: { authorization: "Bearer local-test-owner-token", "content-type": "application/json" }, body: JSON.stringify({ collection, revision: 0 }) });
  assert.equal(imported.status, 200, await imported.text());
  const db = await mf.getD1Database("DB");
  treeShortId = (await db.prepare("SELECT short_id FROM public_ids WHERE kind = 'tree' AND entity_id = ?").bind(treeId).first()).short_id;
  const login = await mf.dispatchFetch(`${base}/login`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ password: "local-preview-only" }) });
  assert.equal(login.status, 200); cookie = login.headers.get("set-cookie").split(";")[0];
});
after(async () => { await mf?.dispose(); });
const download = (id = treeShortId, headers = { cookie }) => mf.dispatchFetch(`${base}/t/${id}/gedcom`, { headers });

test("GEDCOM download requires family access and never exposes another tree's members", async () => {
  assert.equal((await download(treeShortId, {})).status, 401);
  assert.equal((await download(randomUUID())).status, 404);
  const response = await download();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="Example-Family.ged"');
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  text = await response.text();
  assert.match(text, /^0 HEAD\r\n/); assert.match(text, /2 VERS 5\.5\.1/); assert.match(text, /0 TRLR\r\n$/);
  assert.equal((text.match(/^0 @I\d+@ INDI/gm) || []).length, members.length);
  assert.ok(!text.includes(outside)); assert.ok(!text.includes("Private outsider"));
  for (const id of members) assert.ok(text.includes(`1 _UID ${id}`));
});
test("GEDCOM preserves families, unmarried partners, single parents, dates and Unicode notes", async () => {
  text = await (await download()).text();
  const records = text.split(/(?=^0 )/m);
  const individuals = records.filter(r => /^0 @I\d+@ INDI/.test(r));
  const families = records.filter(r => /^0 @F\d+@ FAM/.test(r));
  assert.equal(families.length, 3);
  const person = id => individuals.find(r => r.includes(`1 _UID ${id}\r\n`));
  const ref = record => /^0 (@\w+@)/.exec(record)[1];
  const parents = families.find(r => r.includes(`1 HUSB ${ref(person(father))}`));
  assert.ok(parents.includes(`1 WIFE ${ref(person(mother))}`));
  assert.ok(parents.includes(`1 CHIL ${ref(person(child))}`));
  assert.match(parents, /1 MARR\r\n2 DATE 1 JUN 1965/);
  const partners = families.find(r => r.includes("Relationship: partners"));
  assert.ok(partners.includes(ref(person(child)))); assert.ok(partners.includes(ref(person(partner))));
  assert.ok(!partners.includes("MARR"), "partnership does not imply marriage");
  const singleFamily = families.find(r => r.includes(`1 WIFE ${ref(person(single))}`));
  assert.ok(singleFamily.includes(`1 CHIL ${ref(person(loneChild))}`)); assert.ok(!singleFamily.includes("HUSB"));
  assert.match(person(father), /2 DATE 24 OCT 1945/); assert.match(person(father), /2 DATE FEB 2020/);
  assert.match(person(mother), /2 NOTE Date: About 1945/);
  const noteLines = person(father).split("\r\n").filter(l => /^[12] (NOTE|CONT|CONC)/.test(l));
  let restored = "";
  for (const line of noteLines) {
    const [, tag, value = ""] = /^\d (\w+)(?: (.*))?$/.exec(line);
    restored += (tag === "CONT" ? "\n" : "") + value.replaceAll("@@", "@");
  }
  assert.equal(restored, notes);
  for (const line of text.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 240, "UTF-8 lines stay within GEDCOM's limit");
  const defined = new Set(records.map(r => /^0 (@\w+@)/.exec(r)?.[1]).filter(Boolean));
  for (const [, pointer] of text.matchAll(/^1 (?:HUSB|WIFE|CHIL|FAMC|FAMS|SUBM) (@\w+@)/gm)) assert.ok(defined.has(pointer));
  for (const family of families) {
    for (const [, role, pointer] of family.matchAll(/^1 (HUSB|WIFE|CHIL) (@\w+@)/gm)) {
      const individual = individuals.find(r => ref(r) === pointer);
      assert.ok(individual.includes(`1 ${role === "CHIL" ? "FAMC" : "FAMS"} ${ref(family)}`));
    }
  }
});
