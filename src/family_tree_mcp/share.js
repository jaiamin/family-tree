// Browser port of tree.py's kinship rules and diagram.py's Mermaid output for the share page.
// tests/test_share.py checks both against the Python versions.

const STYLES = `    classDef male fill:#dbeafe,stroke:#2563eb,color:#0f172a
    classDef female fill:#fce7f3,stroke:#db2777,color:#0f172a
    classDef unknown fill:#f1f5f9,stroke:#64748b,color:#0f172a
    classDef deceased stroke-dasharray:5 3,fill-opacity:0.6
    classDef focus stroke:#d97706,stroke-width:4px
    classDef union fill:#64748b,stroke:#64748b`;

function birthKey(date) {
  const match = (date || "").match(/\d{4}(?:-\d{2}){0,2}/);
  return match ? [0, match[0]] : [1, ""];
}

function byBirth(tree, ids) {
  const keyed = ids.map((id) => [birthKey(tree.people[id].birth_date), id]);
  keyed.sort(([a], [b]) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return keyed.map(([, id]) => id);
}

function children(tree, id) {
  return byBirth(tree, Object.keys(tree.people).filter((c) => (tree.people[c].parents || []).includes(id)));
}

function siblings(tree, id) {
  const parents = tree.people[id].parents || [];
  return byBirth(
    tree,
    Object.keys(tree.people).filter(
      (s) => s !== id && (tree.people[s].parents || []).some((p) => parents.includes(p)),
    ),
  );
}

function walk(start, step) {
  const dist = new Map([[start, 0]]);
  const queue = [start];
  while (queue.length) {
    const current = queue.shift();
    for (const next of step(current)) {
      if (!dist.has(next)) {
        dist.set(next, dist.get(current) + 1);
        queue.push(next);
      }
    }
  }
  return dist;
}

const ancestors = (tree, id) => walk(id, (i) => tree.people[i].parents || []);
const descendants = (tree, id) => walk(id, (i) => children(tree, i));

const word = (sex, male, female, neutral) => ({ male, female })[sex] || neutral;
const pairKey = (a, b) => [a, b].sort().join("+");
const partnership = (tree, a, b) => (tree.partnerships || {})[pairKey(a, b)];
const divorced = (tree, a, b) => partnership(tree, a, b)?.status === "divorced";

function halfSiblings(tree, a, b) {
  const pa = tree.people[a].parents || [];
  const pb = tree.people[b].parents || [];
  return pa.filter((p) => pb.includes(p)).length === 1 && Math.max(pa.length, pb.length) === 2;
}

function kinship(da, db, sex, half) {
  const grand = (n) => (n === 1 ? "" : "great-".repeat(n - 2) + "grand");
  if (da === 0) return grand(db) + word(sex, "son", "daughter", "child");
  if (db === 0) return grand(da) + word(sex, "father", "mother", "parent");
  if (da === 1 && db === 1) return (half ? "half-" : "") + word(sex, "brother", "sister", "sibling");
  if (da === 1) return "great-".repeat(db - 2) + word(sex, "nephew", "niece", "niece/nephew");
  if (db === 1) return "great-".repeat(da - 2) + word(sex, "uncle", "aunt", "aunt/uncle");
  const degree = Math.min(da, db) - 1;
  const removed = Math.abs(da - db);
  const ordinals = { 1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth" };
  let term = `${ordinals[degree] || `${degree}th`} cousin`;
  if (removed) term += { 1: " once removed", 2: " twice removed" }[removed] || ` ${removed} times removed`;
  return term;
}

const BY_MARRIAGE = {
  "1,0": ["stepfather", "stepmother", "step-parent"],
  "1,1": ["brother-in-law", "sister-in-law", "sibling-in-law"],
  "0,1": ["son-in-law", "daughter-in-law", "child-in-law"],
  "2,1": ["uncle by marriage", "aunt by marriage", "aunt/uncle by marriage"],
};
const IN_LAW = {
  "1,0": ["father-in-law", "mother-in-law", "parent-in-law"],
  "1,1": ["brother-in-law", "sister-in-law", "sibling-in-law"],
  "0,1": ["stepson", "stepdaughter", "stepchild"],
};
const named = (table, da, db, sex) => (table[`${da},${db}`] ? word(sex, ...table[`${da},${db}`]) : null);

function blood(tree, a, b) {
  const upA = ancestors(tree, a);
  const upB = ancestors(tree, b);
  const common = [...upA.keys()].filter((i) => upB.has(i));
  if (!common.length) return null;
  const best = Math.min(...common.map((i) => upA.get(i) + upB.get(i)));
  const nearest = common.filter((i) => upA.get(i) + upB.get(i) === best).sort();
  return [upA.get(nearest[0]), upB.get(nearest[0]), nearest];
}

const term = (tree, a, b, da, db) =>
  kinship(da, db, tree.people[b].sex, da === 1 && db === 1 && halfSiblings(tree, a, b));

function relationship(tree, a, b) {
  const A = tree.people[a];
  const B = tree.people[b];
  if (a === b) return { relationship: "same person" };
  const find = (list, fn) => {
    for (const x of list) {
      const found = fn(x);
      if (found) return [x, found];
    }
    return null;
  };
  let name;
  let via;
  const direct = blood(tree, a, b);
  if (direct) name = term(tree, a, b, direct[0], direct[1]);
  else if ((A.partners || []).includes(b)) {
    if (partnership(tree, a, b)?.status === "married") name = word(B.sex, "husband", "wife", "spouse");
    else if (divorced(tree, a, b)) name = word(B.sex, "ex-husband", "ex-wife", "former spouse");
    else name = "partner";
  } else if ((via = find(B.partners || [], (r) => blood(tree, a, r)))) {
    const [r, [da, db]] = via;
    const former = divorced(tree, r, b) ? "former " : "";
    const named_ = named(BY_MARRIAGE, da, db, B.sex);
    name = named_ ? former + named_ : `${term(tree, a, r, da, db)}'s ${former}partner`;
  } else if ((via = find(A.partners || [], (p) => blood(tree, p, b)))) {
    const [p, [da, db]] = via;
    const former = divorced(tree, a, p) ? "former " : "";
    name = former + (named(IN_LAW, da, db, B.sex) || `partner's ${term(tree, p, b, da, db)}`);
  } else return { relationship: "no known relationship" };
  return { relationship: name, summary: `${B.name} is ${A.name}'s ${name}.` };
}

const escape = (text) => text.replaceAll('"', "#quot;").replaceAll("<", "#lt;").replaceAll(">", "#gt;");
const year = (date) => (date ? date.match(/\d{4}/)?.[0] || escape(date) : null);

function label(person) {
  const birth = year(person.birth_date);
  const death = year(person.death_date);
  let years;
  if (birth && death) years = `${birth}–${death}`;
  else if (birth || death) years = birth ? `b. ${birth}` : `d. ${death}`;
  else return escape(person.name);
  return `${escape(person.name)}<br/><small>${years}</small>`;
}

function select(tree, focus, view, generations) {
  if (!focus) return byBirth(tree, Object.keys(tree.people));
  const near = (dist) => [...dist].filter(([, gen]) => generations == null || gen <= generations).map(([id]) => id);
  const within = new Set([focus]);
  if (view !== "descendants") near(ancestors(tree, focus)).forEach((id) => within.add(id));
  if (view !== "ancestors") {
    const down = new Set([...near(descendants(tree, focus)), focus]);
    down.forEach((id) => {
      within.add(id);
      (tree.people[id].partners || []).forEach((p) => within.add(p));
    });
  }
  return byBirth(tree, Object.keys(tree.people).filter((id) => within.has(id)));
}

function toMermaid(tree, focus = null, view = "both", generations = null) {
  const ids = select(tree, focus, view, generations);
  const node = new Map(ids.map((id, i) => [id, `p${i}`]));
  const lines = ["---", `title: ${JSON.stringify(tree.name)}`, "---", "flowchart TD"];
  ids.forEach((id) => lines.push(`    ${node.get(id)}["${label(tree.people[id])}"]`));

  const unions = new Map();
  const union = (pair) => {
    const members = [...pair].sort((x, y) => ids.indexOf(x) - ids.indexOf(y));
    const key = members.join("\n");
    if (!unions.has(key)) {
      const u = `u${unions.size}`;
      unions.set(key, u);
      lines.push(`    ${u}(( )):::union`);
      const link = partnership(tree, members[0], members[1])?.status === "divorced" ? "-.-" : "---";
      members.forEach((id) => lines.push(`    ${node.get(id)} ${link} ${u}`));
    }
    return unions.get(key);
  };
  for (const id of ids) {
    for (const partner of tree.people[id].partners || []) {
      if (node.has(partner)) union([id, partner]);
    }
  }
  for (const id of ids) {
    const parents = [...new Set(tree.people[id].parents || [])].filter((p) => node.has(p));
    if (parents.length === 2) {
      const u = union(parents);
      lines.push(`    ${u} --> ${node.get(id)}`);
    } else if (parents.length) {
      lines.push(`    ${node.get(parents[0])} --> ${node.get(id)}`);
    }
  }

  lines.push(STYLES);
  const classes = (p) => {
    const set = new Set([p.sex || "unknown"]);
    if (p.death_date) set.add("deceased");
    if (p.id === focus) set.add("focus");
    return set;
  };
  for (const cls of ["male", "female", "unknown", "deceased", "focus"]) {
    const members = ids.filter((id) => classes(tree.people[id]).has(cls)).map((id) => node.get(id));
    if (members.length) lines.push(`    class ${members.join(",")} ${cls}`);
  }
  return { source: lines.join("\n"), nodes: Object.fromEntries([...node].map(([id, n]) => [n, id])) };
}

if (typeof module !== "undefined") {
  module.exports = { relationship, toMermaid, children, siblings, halfSiblings, partnership };
}
