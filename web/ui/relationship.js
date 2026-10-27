// A relationship and its path are calculated together so the explanation matches the graph.
function compareRelationship(tree, from, to) {
  const people = tree.people;
  if (!people[from] || !people[to]) throw new Error("Unknown person");
  const parents = id => (people[id].parents || []).filter(p => people[p]);
  const partners = id => (people[id].partners || []).filter(p => people[p]);
  const word = (id, male, female, neutral) => people[id].sex === "male" ? male : people[id].sex === "female" ? female : neutral;
  const grand = n => n === 1 ? "" : "great-".repeat(n - 2) + "grand";
  function ancestors(start) {
    const paths = new Map([[start, [start]]]);
    for (const [id, path] of paths) {
      for (const p of parents(id).sort()) if (!paths.has(p)) paths.set(p, [...path, p]);
    }
    return paths;
  }
  function blood(a, b) {
    const aa = ancestors(a), bb = ancestors(b);
    const common = [...aa.keys()].filter(id => bb.has(id)).sort((x, y) =>
      aa.get(x).length + bb.get(x).length - aa.get(y).length - bb.get(y).length || x.localeCompare(y));
    if (!common.length) return null;
    const root = common[0], ap = aa.get(root), bp = bb.get(root);
    const da = ap.length - 1, db = bp.length - 1;
    let term;
    if (!da && !db) term = "same person";
    else if (!da) term = grand(db) + word(b, "son", "daughter", "child");
    else if (!db) term = grand(da) + word(b, "father", "mother", "parent");
    else if (da === 1 && db === 1) {
      const pa = parents(a), pb = parents(b);
      const half = pa.some(p => !pb.includes(p)) || pb.some(p => !pa.includes(p));
      term = (half ? "half-" : "") + word(b, "brother", "sister", "sibling");
    } else if (da === 1) term = "great-".repeat(db - 2) + word(b, "nephew", "niece", "niece/nephew");
    else if (db === 1) term = "great-".repeat(da - 2) + word(b, "uncle", "aunt", "aunt/uncle");
    else {
      const degree = Math.min(da, db) - 1, removed = Math.abs(da - db);
      const ordinal = ["", "first", "second", "third", "fourth", "fifth"][degree] || `${degree}${degree % 100 >= 11 && degree % 100 <= 13 ? "th" : ({1:"st",2:"nd",3:"rd"}[degree % 10] || "th")}`;
      term = `${ordinal} cousin${removed ? ` ${removed === 1 ? "once" : removed === 2 ? "twice" : `${removed} times`} removed` : ""}`;
    }
    return { term, path: [...ap, ...bp.slice(0, -1).reverse()] };
  }
  const spouse = (a, b) => tree.partnerships?.[[a, b].sort().join("+")]?.status === "married" ? word(b, "husband", "wife", "spouse") : "partner";
  let result = blood(from, to);
  if (!result && partners(from).includes(to)) result = { term: spouse(from, to), path: [from, to] };
  if (!result) {
    for (const p of partners(to).sort()) {
      const relative = blood(from, p);
      if (relative) { result = { term: `${relative.term}'s ${spouse(p, to)}`, path: [...relative.path, to] }; break; }
    }
  }
  if (!result) {
    for (const p of partners(from).sort()) {
      const relative = blood(p, to);
      if (relative) { result = { term: `${spouse(from, p)}'s ${relative.term}`, path: [from, ...relative.path] }; break; }
    }
  }
  // Extended connections through multiple marriages have no simple kinship label.
  if (!result) {
    const paths = new Map([[from, [from]]]);
    for (const [id, path] of paths) {
      if (id === to) { result = { term: null, path }; break; }
      const kids = Object.keys(people).filter(k => parents(k).includes(id));
      for (const next of [...parents(id), ...partners(id), ...kids].sort()) {
        if (!paths.has(next)) paths.set(next, [...path, next]);
      }
    }
  }
  return result || { term: null, path: [] };
}
if (typeof module !== "undefined") module.exports = { compareRelationship };
