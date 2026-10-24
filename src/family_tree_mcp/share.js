// Family helpers and the tree layout for the share page. tests/test_share.py checks them in Node.

const CARD = { w: 172, h: 52 };
const GAP = { sibling: 16, couple: 16, row: 56, tree: 48, stack: 8, indent: 18 };

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

// Ancestry-style layout. Everyone with parents hangs below one family unit (a person plus the
// partners who married in); couples sit side by side, centred over their children. From
// generation `depth` down, each branch nests as an indented column instead, where a couple stacks
// into one joined card, and runs of children without families of their own always stack.
// layout() picks the depth that shows everyone at the largest size in the given viewport; on
// portrait screens, families stack and only the width fits.
function layout(tree, viewport = { width: 1280, height: 800 }) {
  const ids = byBirth(tree, Object.keys(tree.people));
  const male = (id) => tree.people[id].sex === "male";

  // A partner without parents joins the unit of a partner who has them, or forms a root couple.
  const spouseOf = {};
  for (const id of ids) {
    if (parentsOf(tree, id).length) continue;
    const head = partnersOf(tree, id).find((p) => parentsOf(tree, p).length);
    if (head) spouseOf[id] = head;
  }
  for (const id of ids) {
    if (parentsOf(tree, id).length || spouseOf[id]) continue;
    const other = partnersOf(tree, id).find((p) => !parentsOf(tree, p).length && !spouseOf[p]);
    if (other && !Object.values(spouseOf).includes(id)) {
      const [head, spouse] = male(other) && !male(id) ? [other, id] : [id, other];
      spouseOf[spouse] = head;
    }
  }
  const headOf = (id) => spouseOf[id] || id;
  const spouses = (head) => partnersOf(tree, head).filter((id) => spouseOf[id] === head);
  // Side by side, someone with several partners sits between the first two.
  const members = (head) => {
    const s = spouses(head);
    return s.length > 1 ? [s[0], head, ...s.slice(1)] : [head, ...s];
  };

  // Children hang below their father's unit when both parents lead their own units.
  const kidsOf = {};
  for (const id of ids) {
    const parents = parentsOf(tree, id);
    if (!parents.length) continue;
    const father = parents.find((p) => male(p) && !spouseOf[p]);
    (kidsOf[father || headOf(parents[0])] ||= []).push(id);
  }
  // Each couple's children sit together, in the order the couple appears.
  const group = {};
  for (const [head, kids] of Object.entries(kidsOf)) {
    const order = members(head);
    for (const kid of kids) {
      const other = parentsOf(tree, kid).find((p) => p !== head && order.includes(p));
      group[kid] = order.indexOf(other || head);
    }
    kids.sort((a, b) => group[a] - group[b]);
  }
  const leaf = (id) => !kidsOf[id] && !partnersOf(tree, id).length;
  const unitWidth = (head) => (1 + spouses(head).length) * CARD.w + spouses(head).length * GAP.couple;

  // Boxes measure a branch, then place it with its top-left corner at (x, y).
  const nested = (head) => {
    const kids = (kidsOf[head] || []).map(nested);
    const couple = [head, ...spouses(head)];
    const top = couple.length * CARD.h;
    const w = Math.max(CARD.w, ...kids.map((k) => GAP.indent + k.w));
    const h = top + kids.reduce((sum, k) => sum + GAP.stack + k.h, 0);
    return { w, h, place(x, y, out, hang) {
      couple.forEach((m, i) => {
        out.pos[m] = { x, y: y + i * CARD.h };
        if (couple.length > 1) out.pair[m] = i === 0 ? "top" : i === couple.length - 1 ? "bottom" : "middle";
      });
      if (hang) out.hang[head] = hang;
      let below = y + top;
      for (const k of kids) {
        k.place(x + GAP.indent, below + GAP.stack, out, { x: x + GAP.indent / 2, y: y + top });
        below += GAP.stack + k.h;
      }
    } };
  };
  const stack = (run) => ({
    w: GAP.indent + CARD.w,
    h: run.length * CARD.h + (run.length - 1) * GAP.stack,
    place(x, y, out) {
      run.forEach((id, i) => {
        out.pos[id] = { x: x + GAP.indent, y: y + i * (CARD.h + GAP.stack) };
        out.spine[id] = { x: x + GAP.indent / 2 };
      });
    },
  });
  // A child who married into a neighbouring family moves to that side of the row, so the
  // couple sits next to each other instead of being joined by a line across the tree.
  const side = (kid) => {
    const here = ordered.indexOf(rootOf(kid));
    const there = [kid, ...spouses(kid)].flatMap((m) => partnersOf(tree, m)).map((p) => ordered.indexOf(rootOf(p)));
    return there.some((i) => i > here) ? 1 : there.some((i) => i < here) ? -1 : 0;
  };
  const spread = (head, level, depth) => {
    const kids = [];
    for (const kid of [...(kidsOf[head] || [])].sort((a, b) => side(a) - side(b))) {
      const last = kids[kids.length - 1];
      if (leaf(kid) && last?.run && group[last.run[0]] === group[kid]) last.run.push(kid);
      else kids.push(leaf(kid) ? { run: [kid] } : { id: kid });
    }
    const boxes = kids.map((k) =>
      k.run ? (k.run.length > 1 ? stack(k.run) : spread(k.run[0], level + 1, depth))
        : level + 1 >= depth ? nested(k.id) : spread(k.id, level + 1, depth));
    const kidsW = boxes.reduce((sum, b) => sum + b.w, 0) + Math.max(0, boxes.length - 1) * GAP.sibling;
    const w = Math.max(unitWidth(head), kidsW);
    const h = CARD.h + (boxes.length ? GAP.row + Math.max(...boxes.map((b) => b.h)) : 0);
    return { w, h, place(x, y, out) {
      let left = x + (w - kidsW) / 2;
      for (const b of boxes) {
        b.place(left, y + CARD.h + GAP.row, out);
        left += b.w + GAP.sibling;
      }
      unit(head, x + (w - unitWidth(head)) / 2, y, out);
    } };
  };
  const unit = (head, x, y, out) => {
    members(head).forEach((m, i) => (out.pos[m] = { x: x + i * (CARD.w + GAP.couple), y }));
  };

  // Root families sit side by side, with families linked by marriage next to each other.
  const roots = ids.filter((id) => !parentsOf(tree, id).length && !spouseOf[id]);
  const rootOf = (id) => {
    let current = headOf(id);
    while (parentsOf(tree, current).length) current = headOf(parentsOf(tree, current)[0]);
    return current;
  };
  const ordered = [];
  const visit = (root) => {
    if (ordered.includes(root)) return;
    ordered.push(root);
    ids.filter((id) => rootOf(id) === root).flatMap((m) => partnersOf(tree, m)).map(rootOf).forEach(visit);
  };
  roots.forEach(visit);

  const portrait = viewport.height > viewport.width;
  const sum = (boxes, key) => boxes.reduce((total, b) => total + b[key], 0) + Math.max(0, boxes.length - 1) * GAP.tree;
  let best = null;
  for (let depth = 0; depth <= ids.length && depth < 12; depth++) {
    const boxes = ordered.map((r) => (depth === 0 ? nested(r) : spread(r, 0, depth)));
    const w = portrait ? Math.max(CARD.w, ...boxes.map((b) => b.w)) : sum(boxes, "w");
    const h = portrait ? sum(boxes, "h") : Math.max(CARD.h, ...boxes.map((b) => b.h));
    // Prefer the widest (most Ancestry-like) layout among those that fit equally well.
    const scale = Math.min(1, viewport.width / w, portrait ? 1 : viewport.height / h);
    if (!best || scale >= best.scale - 1e-9) best = { boxes, w, h, scale };
  }
  const out = { pos: {}, spine: {}, hang: {}, pair: {}, family: {} };
  for (const [head, kids] of Object.entries(kidsOf)) for (const kid of kids) out.family[kid] = head;
  let offset = 0;
  for (const box of best?.boxes || []) {
    portrait ? box.place((best.w - box.w) / 2, offset, out) : box.place(offset, 0, out);
    offset += (portrait ? box.h : box.w) + GAP.tree;
  }
  return { ...out, portrait, card: CARD, gap: GAP, width: best?.w || CARD.w, height: best?.h || CARD.h };
}

if (typeof module !== "undefined") {
  module.exports = { layout, children, siblings, halfSiblings, partnership, parentsOf, partnersOf };
}
