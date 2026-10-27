import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const context = vm.createContext({ module: { exports: {} } });
vm.runInContext(readFileSync(new URL("../ui/relationship.js", import.meta.url), "utf8"), context);
const { compareRelationship: compare } = context.module.exports;
const person = (parents = [], partners = [], sex = "") => ({ parents, partners, sex });

test("incomplete parent records do not assert half-siblings; two distinct known parents do", () => {
  const tree = { people: { a: person(["p"]), b: person(["p", "q"]), p: person(), q: person(), r: person() } };
  assert.equal(compare(tree, "a", "b").term, "sibling");
  assert.match(compare(tree, "a", "b").explanation, /incomplete/);
  tree.people.a.parents.push("r");
  assert.equal(compare(tree, "a", "b").term, "half-sibling");
  tree.people.a.parents = ["p", "q"];
  assert.equal(compare(tree, "a", "b").term, "sibling");
  assert.equal(compare(tree, "a", "b").explanation, undefined);
});
test("direct marriage takes precedence over a blood relationship while preserving that context", () => {
  const tree = { people: { a: person(["p"], ["b"]), b: person(["q"], ["a"], "female"), p: person(["g"]), q: person(["g"]), g: person() }, partnerships: { "a+b": { status: "married" } } };
  const result = compare(tree, "a", "b");
  assert.equal(result.term, "wife"); assert.match(result.explanation, /first cousin/);
  assert.deepEqual([...result.path], ["a", "b"]);
});
test("removed cousins explain the generation difference in either direction", () => {
  const tree = { people: { a: person(["p"]), b: person(["q"]), p: person(["g"]), q: person(["g"]), g: person(), child: person(["b"]) } };
  for (const [a, b] of [["a", "child"], ["child", "a"]]) {
    assert.equal(compare(tree, a, b).term, "first cousin once removed");
    assert.equal(compare(tree, a, b).explanation, "Once removed means one generation apart.");
  }
});
test("distant ancestor labels stay concise without losing generation count or path", () => {
  const people = { p0: person() };
  for (let i = 1; i <= 20; i++) people[`p${i}`] = person([`p${i - 1}`]);
  assert.equal(compare({ people }, "p20", "p0").term, "ancestor (20 generations back)");
  assert.equal(compare({ people }, "p0", "p20").term, "descendant (20 generations down)");
  assert.equal(compare({ people }, "p20", "p0").path.length, 21);
  people.aunt = person(["p0"], [], "female");
  assert.equal(compare({ people }, "p20", "aunt").term, "aunt (19 generations back)");
});
