// Family helpers and the tree layout for the share page. tests/test_share.py checks them in Node.

const CARD = { w: 172, h: 52 };
const ROUTE_GAP = 12;

const parentsOf = (tree, id) => (tree.people[id].parents || []).filter((p) => tree.people[p]);
const partnersOf = (tree, id) => (tree.people[id].partners || []).filter((p) => tree.people[p]);
const pairKey = (a, b) => [a, b].sort().join("+");
const partnership = (tree, a, b) => (tree.partnerships || {})[pairKey(a, b)];

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
  return byBirth(tree, Object.keys(tree.people).filter((c) => parentsOf(tree, c).includes(id)));
}

function siblings(tree, id) {
  const parents = parentsOf(tree, id);
  return byBirth(
    tree,
    Object.keys(tree.people).filter((s) => s !== id && parentsOf(tree, s).some((p) => parents.includes(p))),
  );
}

function halfSiblings(tree, a, b) {
  const pa = parentsOf(tree, a);
  const pb = parentsOf(tree, b);
  return pa.filter((p) => pb.includes(p)).length === 1 && Math.max(pa.length, pb.length) === 2;
}

// Ordinary couples form a single block. Multiple partnerships remain separate people linked
// through their own family junctions, so no person is duplicated or assigned extra children.
function familyGraph(tree) {
  const ids = byBirth(tree, Object.keys(tree.people));
  const families = new Map(), partners = new Map(ids.map((id) => [id, new Set()]));
  const family = (parents) => {
    const key = [...parents].sort().join("+");
    if (!families.has(key)) families.set(key, { key, parents, children: [] });
    if (parents.length === 2) {
      partners.get(parents[0]).add(parents[1]);
      partners.get(parents[1]).add(parents[0]);
    }
    return families.get(key);
  };
  for (const id of ids) {
    for (const other of partnersOf(tree, id)) family([id, other]);
    const parents = parentsOf(tree, id);
    if (parents.length) family(parents).children.push(id);
  }
  const units = [], owner = new Map();
  for (const id of ids) {
    if (owner.has(id)) continue;
    const other = [...partners.get(id)].find((p) => partners.get(id).size === 1 && partners.get(p).size === 1 && !owner.has(p));
    const members = [id, ...(other ? [other] : [])];
    const unit = { id: `person:${id}`, members,
      width: CARD.w + (other ? ROUTE_GAP * 2 : 0), height: CARD.h * members.length };
    units.push(unit);
    for (const p of members) owner.set(p, unit);
  }
  return { units, owner, families };
}

async function layout(tree, direction = "DOWN") {
  const horizontal = direction === "RIGHT";
  const { units, owner, families } = familyGraph(tree);
  const nodes = units.map((u) => ({ id: u.id, width: u.width, height: u.height,
    ports: [], layoutOptions: { "elk.portConstraints": "FIXED_POS" } }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const offset = (id) => {
    const u = owner.get(id), i = u.members.indexOf(id);
    return { x: 0, y: i * CARD.h };
  };
  const port = (unit, id, x, y, side) => {
    byId.get(unit.id).ports.push({ id, x, y, width: 0, height: 0,
      layoutOptions: { "elk.port.side": side } });
    return id;
  };
  const outlets = new Map();
  const outlet = (id, span = CARD.h) => {
    const count = [...families.values()].filter((f) => f.parents.includes(id)).length;
    const index = (outlets.get(id) || 0) + 1;
    outlets.set(id, index);
    return offset(id).y + span * index / (count + 1);
  };
  const edges = [], routes = [], dots = [];
  for (const f of families.values()) {
    const u = owner.get(f.parents[0]);
    const together = f.parents.length === 2 && owner.get(f.parents[1]) === u;
    let output;
    if (together || f.parents.length === 1) {
      output = together
        ? port(u, `out:${f.key}`, horizontal ? u.width : CARD.w + ROUTE_GAP, horizontal ? u.height / 2 : u.height, horizontal ? "EAST" : "SOUTH")
        : port(u, `out:${f.key}`, CARD.w, outlet(f.parents[0]), "EAST");
      f.internal = together;
    } else {
      // Each union gets its own junction, including former partnerships and half-sibling groups.
      const junction = { id: `family:${f.key}`, width: 8, height: 8 };
      nodes.push(junction);
      output = junction.id;
      f.junction = junction.id;
      for (const id of f.parents) {
        const parent = owner.get(id);
        const source = horizontal
          ? port(parent, `union:${f.key}:${id}`, parent.width, outlet(id), "EAST")
          : port(parent, `union:${f.key}:${id}`, outlet(id, CARD.w), parent.height, "SOUTH");
        edges.push({ id: `union:${f.key}:${id}`, sources: [source], targets: [output] });
      }
    }
    for (const id of f.children) {
      const child = owner.get(id), p = offset(id);
      // The lower card of a joined couple needs side entry to avoid crossing its partner.
      const fromTop = !horizontal && p.y === 0;
      const target = port(child, `in:${id}`, fromTop ? CARD.w / 2 : 0,
        fromTop ? 0 : p.y + CARD.h / 2, fromTop ? "NORTH" : "WEST");
      edges.push({ id: `child:${id}`, sources: [output], targets: [target] });
    }
  }
  const Elk = typeof module !== "undefined" ? require("./vendor/elk.bundled.js") : ELK;
  const graph = await new Elk().layout({ id: "tree", children: nodes, edges,
    layoutOptions: {
      "elk.algorithm": "layered", "elk.direction": direction, "elk.edgeRouting": "ORTHOGONAL",
      "elk.separateConnectedComponents": "false", "elk.spacing.nodeNode": "32",
      "elk.layered.spacing.nodeNodeBetweenLayers": "72", "elk.spacing.edgeEdge": "12",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "12",
      "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
      "elk.padding": "[top=24,left=24,bottom=24,right=24]",
    },
  });
  const placed = new Map(graph.children.map((n) => [n.id, n]));
  // Normalize sub-pixel arithmetic before classifying horizontal/vertical segments.
  const point = ({ x, y }) => ({ x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 });
  const pos = {}, cards = [];
  for (const u of units) {
    const n = placed.get(u.id);
    u.members.forEach((id) => {
      const p = offset(id);
      pos[id] = point({ x: n.x + p.x, y: n.y + p.y });
      cards.push({ personId: id, ...pos[id], joined: u.members.length === 2 ? (id === u.members[0] ? "top" : "bottom") : "" });
    });
  }
  for (const f of families.values()) {
    const u = owner.get(f.parents[0]), n = placed.get(u.id);
    if (f.internal) {
      const x = n.x + CARD.w, y = n.y + u.height / 2;
      if (f.children.length) {
        routes.push({ kind: "child", parents: f.parents, children: f.children, people: [...f.children, ...f.parents], net: f.key,
          // Exit beside the lower partner, then descend without crossing either card.
          points: horizontal ? [{ x, y }, { x: n.x + u.width, y }]
            : [{ x, y }, { x: n.x + CARD.w + ROUTE_GAP, y },
              { x: n.x + CARD.w + ROUTE_GAP, y: n.y + u.height }] });
      }
    }
    if (f.parents.length === 1 && u.members.length === 2) {
      const y = n.y + n.ports.find((p) => p.id === `out:${f.key}`).y;
      routes.push({ kind: "child", parents: f.parents, children: f.children,
        people: [...f.parents, ...f.children], net: f.key,
        points: [{ x: n.x + CARD.w, y }, { x: n.x + u.width, y }] });
    }
    if (f.junction) {
      const j = placed.get(f.junction);
      dots.push({ x: j.x + j.width / 2, y: j.y + j.height / 2, people: f.parents, net: f.key });
    }
  }
  for (const edge of graph.edges) {
    const id = edge.id.startsWith("child:") ? edge.id.slice(6) : null;
    const f = id ? families.get([...parentsOf(tree, id)].sort().join("+"))
      : [...families.values()].find((f) => edge.id.startsWith(`union:${f.key}:`));
    for (const s of edge.sections || []) {
      const points = [s.startPoint, ...(s.bendPoints || []), s.endPoint];
      if (f.junction) {
        const j = placed.get(f.junction), center = { x: j.x + j.width / 2, y: j.y + j.height / 2 };
        if (id) points.unshift(center, { x: s.startPoint.x, y: center.y });
        else points.push({ x: s.endPoint.x, y: center.y }, center);
      }
      routes.push({ points, net: f.key, kind: id ? "child" : "couple",
        people: id ? [id, ...f.parents] : f.parents,
        className: !id && partnership(tree, ...f.parents)?.status === "divorced" ? "former" : "",
        ...(id ? { parents: f.parents, children: [id] } : {}),
      });
    }
  }

  return { nodes: cards, pos, routes: routes.map((r) => ({ ...r, points: r.points.map(point) })),
    dots: dots.map((d) => ({ ...d, ...point(d) })), card: CARD, width: graph.width || CARD.w, height: graph.height || CARD.h };
}

// Shared buses are drawn once. Keep ownership on every segment so sibling selection highlights
// their common trunk correctly; this also prevents overlapping copies of the same line.
function connections(geometry, pad = 0) {
  const lines = new Map(), result = [];
  for (const r of geometry.routes) for (let i = 1; i < r.points.length; i++) {
    const a = r.points[i - 1], b = r.points[i];
    if (a.x === b.x && a.y === b.y) continue;
    const vertical = a.x === b.x, fixed = vertical ? a.x : a.y;
    const key = `${r.net}:${vertical}:${fixed}`;
    if (!lines.has(key)) lines.set(key, { vertical, fixed, segments: [] });
    lines.get(key).segments.push({ start: Math.min(vertical ? a.y : a.x, vertical ? b.y : b.x),
      end: Math.max(vertical ? a.y : a.x, vertical ? b.y : b.x), route: r });
  }
  for (const { vertical, fixed, segments } of lines.values()) {
    const stops = [...new Set(segments.flatMap((s) => [s.start, s.end]))].sort((a, b) => a - b);
    for (let i = 1; i < stops.length; i++) {
      const start = stops[i - 1], end = stops[i];
      const owners = segments.filter((s) => s.start <= start && s.end >= end).map((s) => s.route);
      if (!owners.length) continue;
      const base = owners.find((r) => r.kind === "child") || owners[0], children = [...new Set(owners.flatMap((r) => r.children || []))];
      const a = vertical ? { x: fixed + pad, y: start + pad } : { x: start + pad, y: fixed + pad };
      const b = vertical ? { x: fixed + pad, y: end + pad } : { x: end + pad, y: fixed + pad };
      result.push({ ...base, children, points: [a, b], className: base.className || "", d: `M${a.x},${a.y}${vertical ? `V${b.y}` : `H${b.x}`}` });
    }
  }
  for (const dot of geometry.dots) {
    const x = dot.x + pad, y = dot.y + pad;
    result.push({ ...dot, kind: "couple", className: "dot", d: `M${x - 3.5},${y}a3.5,3.5 0 1,0 7,0a3.5,3.5 0 1,0 -7,0` });
  }
  return result;
}

if (typeof module !== "undefined") {
  module.exports = { layout, connections, familyGraph, children, siblings, halfSiblings, partnership, parentsOf, partnersOf };
}
