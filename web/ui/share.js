import { byId as $ } from "../src/dom.js";
import { familySite } from "../src/client.js";
import { layout, connections, children, siblings, halfSiblings, partnership, parentsOf, partnersOf } from "./layout.js";
import { compareRelationship } from "./relationship.js";
import { createPhotoCrop } from "./photo-crop.js";
(async () => {
const tree = await familySite.loadTree();
const apiUrl = path => familySite.base + path;
const treeUrl = new URL(apiUrl(`/t/${tree.short_id}`), location.origin).href;
const ids = Object.keys(tree.people);
const photoCleanups = new WeakMap();
const view = $("canvas");
const stage = $("stage");
const svgNS = "http://www.w3.org/2000/svg";
const PLACEHOLDER = /^Unknown parent of /;

const person = (id) => tree.people[id];
const displayName = (id) => (PLACEHOLDER.test(person(id).name) ? "Unknown" : person(id).name);
const initials = (id) =>
  PLACEHOLDER.test(person(id).name) ? "?" : (person(id).name.match(/\p{L}+/gu) || ["?"]).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const year = (date) => date?.match(/\d{4}/)?.[0] || date;
function years(p) {
  if (p.birth_date && p.death_date) return `${year(p.birth_date)}–${year(p.death_date)}`;
  if (p.birth_date) return `b. ${year(p.birth_date)}`;
  if (p.death_date) return `d. ${year(p.death_date)}`;
  return "";
}
function formatDate(value) {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day || "01"}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== `${year}-${month}-${day || "01"}`) return value;
  return new Intl.DateTimeFormat("en-GB", { ...day ? { day: "numeric" } : {}, month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}
function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k === "class" ? (node.className = v) : node.setAttribute(k, v);
  node.append(...kids.filter((k) => k != null && k !== ""));
  return node;
}
// A person's current photo is shared across every tree and relationship list.
const photos = tree.photo_versions; // person id -> current photo version
function paint(circle) {
  const id = circle.dataset.avatar;
  const current = circle.querySelector("img");
  if (current && current.dataset.version === photos[id]) return;
  current?.remove();
  circle.removeAttribute("data-loading");
  if (!photos[id]) return;
  const img = el("img", { src: apiUrl(`/api/photos/${id}?v=${photos[id]}`), alt: "", decoding: "async", "data-version": photos[id] });
  circle.setAttribute("data-loading", "true");
  img.onload = () => { if (img.parentElement === circle) circle.removeAttribute("data-loading"); };
  img.onerror = () => { if (img.parentElement === circle) circle.removeAttribute("data-loading"); img.remove(); };
  circle.append(img);
}
const repaint = (id) => document.querySelectorAll(`[data-avatar="${id}"]`).forEach(paint);
const genderLabel = id => person(id).sex === "male" ? "Male" : person(id).sex === "female" ? "Female" : "";
function avatar(id, size = "") {
  const gender = person(id).sex, label = genderLabel(id);
  const circle = el("span", { class: `avatar ${size}`, "data-avatar": id,
    ...label ? { "data-gender": gender, role: "img", "aria-label": label, title: label } : { "aria-hidden": "true" },
  }, initials(id));
  paint(circle);
  return circle;
}

const treeSwitch = $("tree-switch"), treeOptions = $("tree-options");
function closeTreeOptions() {
  treeOptions.hidden = true;
  treeSwitch.setAttribute("aria-expanded", "false");
}
function openTreeOptions() {
  treeOptions.hidden = false;
  const anchor = treeSwitch.getBoundingClientRect();
  treeOptions.style.left = `${Math.max(16, Math.min(anchor.left, innerWidth - treeOptions.offsetWidth - 16))}px`;
  treeOptions.style.top = `${anchor.bottom + 6}px`;
  treeSwitch.setAttribute("aria-expanded", "true");
}
window.addEventListener("resize", closeTreeOptions);
treeSwitch.onclick = () => {
  const open = treeOptions.hidden;
  open ? openTreeOptions() : closeTreeOptions();
};
document.addEventListener("click", (event) => {
  if (event.target instanceof Element && !event.target.closest(".tree-picker")) closeTreeOptions();
});
document.addEventListener("focusin", (event) => {
  if (event.target instanceof Element && !event.target.closest(".tree-picker")) closeTreeOptions();
});
document.querySelector(".tree-picker").addEventListener("keydown", (event) => {
  if (!(event instanceof KeyboardEvent)) return;
  if (event.key === "Escape") {
    closeTreeOptions();
    treeSwitch.focus();
    event.preventDefault();
  } else if (["ArrowDown", "ArrowUp"].includes(event.key)) {
    const links = [...treeOptions.querySelectorAll("a")];
    const index = links.findIndex(link => link === document.activeElement);
    const next = event.key === "ArrowDown" ? (index + 1) % links.length
      : (index < 0 ? links.length - 1 : (index - 1 + links.length) % links.length);
    openTreeOptions();
    links[next].focus();
    event.preventDefault();
  }
});
$("count").textContent = `${ids.length} ${ids.length === 1 ? "person" : "people"}`;
document.title = `${tree.name} · ${tree.site_name}`;

let shareNotice;
async function shareLink(button, title, url) {
  const focus = document.activeElement;
  button.disabled = true;
  const status = $("share-status");
  clearTimeout(shareNotice);
  status.textContent = "";
  const notify = (message) => {
    status.textContent = message;
    shareNotice = setTimeout(() => { status.textContent = ""; }, 3000);
  };
  try {
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        if (error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const field = el("textarea", { readonly: "", style: "position:fixed;opacity:0" });
      field.value = url;
      document.body.append(field);
      try {
        field.select();
        if (!document.execCommand("copy")) throw new Error("Copy failed");
      } finally {
        field.remove();
      }
    }
    notify("Link copied");
  } catch {
    notify("Couldn't copy the link. Copy the address from your browser.");
  } finally {
    button.disabled = false;
    if (document.activeElement === document.body) if (focus instanceof HTMLElement) focus.focus({ preventScroll: true });
  }
}
$("share-tree").onclick = () => shareLink($("share-tree"), `${tree.name} · ${tree.site_name}`, treeUrl);

// Tree

let listMode = false;
let direction = "DOWN";
try { if (localStorage.getItem("tree-layout") === "RIGHT") direction = "RIGHT"; } catch {}
try { listMode = localStorage.getItem("tree-view") === "LIST"; } catch {}
let geometry = await layout(tree, direction);
let { pos, card, width, height } = geometry;
const PAD = 48;
stage.style.width = `${width + PAD * 2}px`;
stage.style.height = `${height + PAD * 2}px`;
const lines = $("lines");
lines.setAttribute("width", width + PAD * 2);
lines.setAttribute("height", height + PAD * 2);
const at = (id) => ({ x: Math.round(pos[id].x) + PAD, y: Math.round(pos[id].y) + PAD });

const cards = {};
for (const c of geometry.nodes) {
  const id = c.personId, p = person(id);
  const caption = years(p);
  const node = el("button", {
    class: `person${c.joined ? ` joined-${c.joined}` : ""}${PLACEHOLDER.test(p.name) ? " unknown" : ""}`,
    "data-id": id, "aria-label": [p.name, caption, genderLabel(id)].filter(Boolean).join(", "),
  }, avatar(id), el("span", { class: "text" }, el("span", { class: "name" }, displayName(id)),
    caption && el("span", { class: "years" }, caption)));
  Object.assign(node.style, { left: `${c.x + PAD}px`, top: `${c.y + PAD}px`, width: `${card.w}px`, height: `${card.h}px` });
  stage.append(node);
  cards[id] = node;
}

const edges = [];
function edge(e) {
  const { d, className = "" } = e;
  const path = document.createElementNS(svgNS, "path");
  path.setAttribute("d", d);
  if (className) path.setAttribute("class", className);
  lines.append(path);
  edges.push({ ...e, path });
  return path;
}
for (const e of connections(geometry, PAD)) {
  edge(e);
}

// Pan and zoom

const camera = { x: 0, y: 0, scale: 1 };
const viewKey = `family-view:${tree.id}`;
document.addEventListener("family-tree-before-reload", () => {
  if (!selected) return;
  const p = at(selected);
  try { sessionStorage.setItem(viewKey, JSON.stringify({
    id: selected, scale: camera.scale, expanded: $("card")?.classList.contains("expanded"),
    x: (camera.x + p.x * camera.scale) / view.clientWidth,
    y: (camera.y + p.y * camera.scale) / view.clientHeight,
  })); } catch {}
});
function apply(glide = false) {
  stage.classList.toggle("glide", glide);
  stage.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
}
function zoomAt(scale, cx = view.clientWidth / 2, cy = view.clientHeight / 2, glide = false) {
  scale = Math.min(2, Math.max(0.15, scale));
  camera.x = cx - ((cx - camera.x) * scale) / camera.scale;
  camera.y = cy - ((cy - camera.y) * scale) / camera.scale;
  camera.scale = scale;
  apply(glide);
}
function fit(glide = false) {
  const w = width + PAD * 2;
  const h = height + PAD * 2;
  camera.scale = Math.min(1, view.clientWidth / w, view.clientHeight / h);
  camera.x = (view.clientWidth - w * camera.scale) / 2;
  camera.y = Math.max(0, (view.clientHeight - h * camera.scale) / 2);
  apply(glide);
}
// The canvas excludes the sidebar or mobile sheet, so framing uses its actual free space.
function room() {
  return { w: view.clientWidth, h: view.clientHeight };
}
function bounds(group) {
  const xs = group.map((g) => at(g).x);
  const ys = group.map((g) => at(g).y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs) + card.w, h: Math.max(...ys) - Math.min(...ys) + card.h };
}
function inView(group) {
  const b = bounds(group);
  const { w, h } = room();
  const [x, y, s] = [camera.x, camera.y, camera.scale];
  return x + b.x * s >= 0 && y + b.y * s >= 0 && x + (b.x + b.w) * s <= w && y + (b.y + b.h) * s <= h && s >= 0.6;
}
// Frames the person with their line, zooming out only as far as needed.
function centreOn([id, ...group], { fitAll = false } = {}) {
  if (listMode) return false;
  const b = bounds([id, ...group]);
  const { w, h } = room();
  const fitScale = Math.min(1, Math.max(1, w - 48) / b.w, Math.max(1, h - 48) / b.h);
  const scale = fitAll ? fitScale : Math.max(0.6, Math.min(camera.scale, fitScale));
  camera.scale = scale;
  camera.x = w / 2 - (b.x + b.w / 2) * scale;
  // Leave room below the selection for relatives and the details panel.
  camera.y = h / 2 - (b.y + b.h / 2) * scale;
  if (!fitAll) camera.y = Math.min(camera.y, 64 - b.y * scale);
  // When the whole line can't fit at a readable size, keep the person in view.
  if (!fitAll) {
    const p = at(id);
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    camera.x = clamp(camera.x, 24 - p.x * scale, w - 24 - (p.x + card.w) * scale);
    camera.y = clamp(camera.y, 24 - p.y * scale, h - 24 - (p.y + card.h) * scale);
  }
  const before = stage.style.transform;
  apply(true);
  return stage.style.transform !== before;
}

const pointers = new Map();
let moved = false;
let pinch = null;
view.addEventListener("pointerdown", (e) => {
  if (listMode || (e.target instanceof Element ? e.target : document.body).closest("#card, .zoom")) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  moved = false;
  if (pointers.size === 2) {
    const [p, q] = [...pointers.values()];
    pinch = { dist: Math.hypot(p.x - q.x, p.y - q.y), scale: camera.scale };
  }
});
view.addEventListener("pointermove", (e) => {
  const last = pointers.get(e.pointerId);
  if (!last) return;
  const dx = e.clientX - last.x;
  const dy = e.clientY - last.y;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2 && pinch) {
    const [p, q] = [...pointers.values()];
    const box = view.getBoundingClientRect();
    zoomAt((pinch.scale * Math.hypot(p.x - q.x, p.y - q.y)) / pinch.dist, (p.x + q.x) / 2 - box.left, (p.y + q.y) / 2 - box.top);
    moved = true;
  } else if (pointers.size === 1 && (moved || Math.abs(dx) + Math.abs(dy) > 3)) {
    if (!moved) view.setPointerCapture(e.pointerId);
    moved = true;
    view.classList.add("dragging");
    camera.x += dx;
    camera.y += dy;
    apply();
  }
});
const release = (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (!pointers.size) view.classList.remove("dragging");
};
view.addEventListener("pointerup", release);
view.addEventListener("pointercancel", release);
view.addEventListener("wheel", (e) => {
  if (listMode || (e.target instanceof Element ? e.target : document.body).closest("#card")) return;
  e.preventDefault();
  const box = view.getBoundingClientRect();
  zoomAt(camera.scale * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - box.left, e.clientY - box.top);
}, { passive: false });
const mobileZoom = matchMedia("(max-width: 640px)");
function orderZoomButtons() {
  const first = $(mobileZoom.matches ? "zoom-out" : "zoom-in");
  const second = $(mobileZoom.matches ? "zoom-in" : "zoom-out");
  if (first.nextElementSibling !== second) first.parentElement.insertBefore(first, second);
}
mobileZoom.addEventListener("change", orderZoomButtons);
orderZoomButtons();
$("zoom-in").onclick = () => zoomAt(camera.scale * 1.3, undefined, undefined, true);
$("zoom-out").onclick = () => zoomAt(camera.scale / 1.3, undefined, undefined, true);
$("zoom-fit").onclick = () => { close(); fit(true); };

function updateLayoutButtons() {
  const input = $("search");
  input.setAttribute("role", listMode ? "searchbox" : "combobox");
  input.setAttribute("aria-controls", listMode ? "people-list" : "results");
  if (listMode) {
    input.removeAttribute("aria-autocomplete");
    input.removeAttribute("aria-expanded");
  } else {
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
  }
  $("layout-list").setAttribute("aria-pressed", String(listMode));
  view.classList.toggle("list-mode", listMode);
  stage.hidden = listMode;
  $("people-list").hidden = !listMode;
  $("zoom-controls").hidden = listMode;
  $("layout-down").setAttribute("aria-pressed", String(!listMode && direction === "DOWN"));
  $("layout-right").setAttribute("aria-pressed", String(!listMode && direction === "RIGHT"));
}
async function switchLayout(next) {
  if (next === "LIST") {
    listMode = true;
    updateLayoutButtons();
    showResults();
    try { localStorage.setItem("tree-view", "LIST"); } catch {}
    return;
  }
  const wasList = listMode;
  listMode = false;
  updateLayoutButtons();
  showResults();
  try { localStorage.setItem("tree-view", "GRAPH"); } catch {}
  if (next === direction) {
    if (wasList && selected) centreOn(comparison?.to ? comparisonFrame() : [selected], { fitAll: Boolean(comparison?.to) });
    return;
  }
  const buttons = [$("layout-down"), $("layout-right"), $("layout-list")];
  buttons.forEach((button) => button.disabled = true);
  try {
    const nextGeometry = await layout(tree, next);
    geometry = nextGeometry;
    ({ pos, card, width, height } = geometry);
    direction = next;
    stage.style.width = `${width + PAD * 2}px`;
    stage.style.height = `${height + PAD * 2}px`;
    lines.setAttribute("width", width + PAD * 2);
    lines.setAttribute("height", height + PAD * 2);
    for (const c of geometry.nodes) {
      Object.assign(cards[c.personId].style, { left: `${c.x + PAD}px`, top: `${c.y + PAD}px` });
    }
    lines.replaceChildren();
    edges.length = 0;
    for (const e of connections(geometry, PAD)) edge(e);
    if (selected) {
      comparison?.to ? highlightComparison() : highlight(selected);
      if (comparison?.to) centreOn(comparisonFrame(), { fitAll: true });
      else {
        const p = at(selected);
        camera.x = view.clientWidth / 2 - (p.x + card.w / 2) * camera.scale;
        camera.y = view.clientHeight / 2 - (p.y + card.h / 2) * camera.scale;
        apply();
      }
    } else fit();
    updateLayoutButtons();
    try { localStorage.setItem("tree-layout", direction); } catch {}
  } catch (error) {
    console.error("Unable to switch tree layout", error);
  } finally {
    buttons.forEach((button) => button.disabled = false);
  }
}
$("layout-list").onclick = () => switchLayout("LIST");
$("layout-down").onclick = () => switchLayout("DOWN");
$("layout-right").onclick = () => switchLayout("RIGHT");
window.addEventListener("resize", () => {
  if (comparison?.to) centreOn(comparisonFrame(), { fitAll: true });
});
updateLayoutButtons();

// Person card

let selected = null;
let comparison = null;
function comparisonFrame() {
  return comparison.result.path.length ? comparison.result.path : [comparison.from, comparison.to];
}
function resetComparison() {
  comparison = null;
}
function highlightComparison() {
  unhighlight();
  const path = comparison.result.path;
  const pairs = path.slice(1).map((id, i) => [path[i], id]);
  stage.classList.add("dim");
  for (const id of ids) {
    cards[id].classList.toggle("related", path.includes(id) || id === comparison.from || id === comparison.to);
    cards[id].classList.toggle("selected", id === comparison.from || id === comparison.to);
  }
  for (const edge of edges) {
    const on = pairs.some(([a, b]) => edge.kind === "child"
      ? (edge.parents.includes(a) && edge.children.includes(b)) || (edge.parents.includes(b) && edge.children.includes(a))
      : edge.people.includes(a) && edge.people.includes(b));
    edge.path.classList.toggle("on", on);
    if (on) lines.append(edge.path);
  }
}
function startComparison(id) {
  comparison = { from: id };
  select(id, true);
  $("compare-search").focus({ preventScroll: true });
}
function renderComparison(box) {
  const { from, to, result } = comparison;
  box.classList.add("comparing");
  box.setAttribute("aria-label", "Compare relationship");
  box.querySelector(".top").replaceChildren(el("h2", {}, "Compare relationship"));
  box.photoCleanup?.();
  box.querySelector(".person-editing")?.remove();
  const body = box.querySelector(".details-body");
  const origin = el("div", { class: "compare-person" }, avatar(from), el("span", { class: "name" }, displayName(from)));
  body.replaceChildren(origin);
  if (!to) {
    const label = el("label", { for: "compare-search", class: "compare-label" }, "Compare with");
    const input = el("input", {
      id: "compare-search", type: "search", placeholder: "Search by name", autocomplete: "off",
      role: "combobox", "aria-autocomplete": "list", "aria-expanded": "false", "aria-controls": "compare-results",
    });
    const results = el("div", { id: "compare-results", role: "listbox" });
    const empty = el("p", { class: "none", role: "status", hidden: "" }, "No matching people");
    let matches = [], active = -1;
    function activate(index) {
      active = index;
      [...results.children].forEach((row, i) => row.setAttribute("aria-selected", String(i === active)));
      if (active >= 0) input.setAttribute("aria-activedescendant", `compare-option-${active}`);
      else input.removeAttribute("aria-activedescendant");
    }
    input.oninput = () => {
      const terms = input.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
      matches = terms.length ? ids.filter(id => id !== from && !PLACEHOLDER.test(person(id).name)
        && terms.every(term => person(id).name.toLowerCase().includes(term))).slice(0, 8) : [];
      results.replaceChildren(...matches.map((id, i) => {
        const row = el("div", { class: "relative", id: `compare-option-${i}`, role: "option" },
          avatar(id), el("span", { class: "name" }, displayName(id)), years(person(id)) && el("span", { class: "note" }, years(person(id))));
        row.onpointerenter = () => activate(i);
        row.onpointerdown = event => { event.preventDefault(); select(id); };
        return row;
      }));
      empty.hidden = !terms.length || Boolean(matches.length);
      input.setAttribute("aria-expanded", String(Boolean(matches.length)));
      activate(matches.length ? 0 : -1);
    };
    input.onkeydown = event => {
      if (["ArrowDown", "ArrowUp"].includes(event.key) && matches.length) {
        event.preventDefault();
        activate((active + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
        results.children[active].scrollIntoView({ block: "nearest" });
      } else if (event.key === "Enter" && active >= 0) { event.preventDefault(); select(matches[active]); }
    };
    body.append(label, input, el("p", { class: "compare-hint" }, "Or select someone in the tree."), results, empty);
  } else {
    body.classList.add("comparison-result");
    body.replaceChildren();
    const summary = from === to ? "The same person" : result.term
      ? `${displayName(to)} is ${displayName(from)}’s ${result.term}.`
      : result.path.length ? "Connected through family" : "No recorded connection in this tree.";
    body.append(el("p", { class: "compare-summary", role: "status", tabindex: "-1" }, summary));
    if (result.explanation) body.append(el("p", { class: "compare-explanation" }, result.explanation));
    if (result.path.length > 1) {
      const path = el("ol", { class: "compare-path", "aria-label": "Connection path" });
      result.path.forEach((id, i) => {
        const previous = result.path[i - 1];
        const step = !previous ? "" : parentsOf(tree, previous).includes(id) ? "Parent" : parentsOf(tree, id).includes(previous) ? "Child" : "Partner";
        const row = relativeRow(id);
        row.onclick = () => centreOn([id]);
        path.append(el("li", {}, step && el("span", { class: "path-step" }, step), row));
      });
      body.append(el("h3", { class: "path-heading" }, "Connection path"), path);
    }
  }
  const back = el("button", { class: "action" }, "Back to person");
  back.onclick = () => { resetComparison(); select(from); };
  const change = to && el("button", { class: "action" }, "Change person");
  if (change) change.onclick = () => startComparison(from);
  box.querySelector(".actions").replaceChildren(back, ...(change ? [change] : []));
}
// Each relative's years tell apart people who share a name.
function relativeRow(id, note = "") {
  const side = [note, years(person(id))].filter(Boolean).join(" · ");
  const row = el("button", { class: "relative" }, avatar(id), el("span", { class: "name" }, displayName(id)), side && el("span", { class: "note" }, side));
  row.onclick = () => select(id);
  return row;
}
function group(title, list, note) {
  if (!list.length) return null;
  return el("section", {}, el("h3", {}, title), ...list.map((id) => relativeRow(id, note?.(id))));
}
function partnerNote(id, other) {
  const d = partnership(tree, id, other) || {};
  if (d.status === "married") return d.marriage_date ? `Married ${year(d.marriage_date)}` : "Married";
  return "";
}

async function send(method, id = "", body = null) {
  const headers = body ? { "content-type": body.type } : {};
  return fetch(apiUrl(`/api/photos${id && `/${id}`}`), { method, headers, body });
}
const errorOf = async response => (await response.json().catch(() => ({}))).error || "Something went wrong. Try again.";

function photoEditor(id) {
  const circle = avatar(id, "lg");
  if (PLACEHOLDER.test(person(id).name)) return { circle };
  const badge = el("span", { class: "badge", "aria-hidden": "true" });
  badge.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/></svg>';
  const button = el("button", { class: "photo", "aria-label": `Photo of ${displayName(id)}`, "aria-haspopup": "dialog" }, circle, badge);
  const label = el("button", { class: "photo-label" }, photos[id] ? "Change photo" : "Add photo");
  let panel, crop, preparation = 0;
  const cleanup = () => { preparation++; crop?.destroy(); crop = null; };
  const hide = () => { if (panel) { panel.box.dirty = false; panel.box.close(); } };
  const note = (text, error = false) => text && el("p", { class: `form-status${error ? " is-error" : ""}`, role: "status" }, text);
  const action = (text, onclick, primary = false) => {
    const node = el("button", { class: `site-button${primary ? " primary" : ""}` }, text);
    node.onclick = onclick; return node;
  };
  function menu(message = "", error = false) {
    const choose = action(photos[id] ? "Change photo" : "Add photo", () => picker.click(), true);
    const remove = photos[id] && familySite.canEdit() ? action("Remove photo", async () => {
      if (!confirm("Remove this profile photo? Uploaded photos will be kept.")) return;
      choose.disabled = remove.disabled = true; panel.box.saving = true; remove.textContent = "Removing…";
      try {
        const response = await send("DELETE", id);
        if (!response.ok) throw new Error(await errorOf(response));
        delete photos[id]; repaint(id); label.textContent = "Add photo"; hide();
      } catch (error) { menu(error.message || "Couldn't connect. Try again.", true); }
      finally { if (panel) panel.box.saving = false; }
    }) : null;
    if (remove) remove.classList.add("danger");
    panel.body.replaceChildren(el("p", { class: "photo-person" }, displayName(id)), avatar(id, "lg"), note(message, error), picker);
    panel.footer.replaceChildren(...[remove, choose].filter(Boolean));
  }
  const picker = el("input", { type: "file", accept: "image/*", hidden: "" });
  picker.onchange = async () => {
    const chosen = picker.files[0]; picker.value = "";
    if (!chosen || !panel) return;
    const current = ++preparation;
    crop?.destroy(); crop = null;
    panel.body.replaceChildren(note("Preparing preview…"), picker); panel.footer.replaceChildren();
    let prepared;
    try { prepared = await createPhotoCrop(chosen); }
    catch { if (panel && current === preparation) menu("Couldn't read that image. Try a JPEG or PNG.", true); return; }
    if (!panel || current !== preparation) { prepared.destroy(); return; }
    crop = prepared; panel.box.dirty = true;
    function preview(message = "") {
      const save = action("Save photo", async () => {
        save.disabled = another.disabled = true; panel.box.saving = true; save.textContent = "Saving…";
        try {
          const response = await send("PUT", id, await crop.blob());
          if (!response.ok) throw new Error(await errorOf(response));
          photos[id] = (await response.json()).v; repaint(id); label.textContent = "Change photo"; hide();
        } catch (error) { if (panel) preview(error.message || "Couldn't connect. Try again."); }
        finally { if (panel) panel.box.saving = false; }
      }, true);
      const another = action("Choose another", () => picker.click());
      panel.body.replaceChildren(el("p", { class: "photo-person" }, displayName(id)), crop.node, note(message, true), picker);
      panel.footer.replaceChildren(another, save);
    }
    preview();
  };
  const open = () => {
    panel = familySite.openDialog("Profile photo");
    if (!panel) return;
    panel.box.classList.add("photo-dialog");
    panel.box.addEventListener("close", () => { cleanup(); panel = null; });
    menu();
  };
  button.onclick = label.onclick = open;
  return { circle: button, label, cleanup: () => { hide(); cleanup(); } };
}

// Emphasize immediate family connections without tracing the entire ancestral tree.
function highlight(id) {
  unhighlight();
  const partners = partnersOf(tree, id);
  const down = new Set(children(tree, id));
  const line = new Set([id, ...parentsOf(tree, id), ...down]);
  const related = new Set([...line, ...partners, ...siblings(tree, id)]);
  stage.classList.add("dim");
  for (const other of ids) cards[other].classList.toggle("related", related.has(other));
  cards[id].classList.add("selected");
  for (const { path, kind, children: kids, parents, people: [a, ...rest] } of edges) {
    const on = kind === "child" ? kids.some((c) => line.has(c)) && parents.some((p) => line.has(p)) : related.has(a) && related.has(rest[0]) && (line.has(a) || line.has(rest[0]));
    path.classList.toggle("on", on);
    // A shared bus carries all of its children.
    if (on) lines.append(path);
  }
  return related;
}

function select(id, preserveComparison = false) {
  if (!preserveComparison && comparison && !comparison.to) {
    comparison.to = id;
    comparison.result = compareRelationship(tree, comparison.from, id);
    id = comparison.from;
    } else if (!preserveComparison && comparison?.to) resetComparison();
  clear();
  selected = id;
  updateListSelection();
  const p = person(id);
  const partners = partnersOf(tree, id);
  const up = parentsOf(tree, id);
  const related = highlight(id);
  const link = el("button", { class: "action", "aria-label": "Share person" }, "Share");
  link.onclick = () => shareLink(link, `${displayName(id)} · ${tree.name}`, `${treeUrl}#${person(id).short_id}`);
  const compare = el("button", { class: "action", "aria-label": "Compare relationship" }, "Compare");
  compare.onclick = () => startComparison(id);
  const facts = [
    ["Born", formatDate(p.birth_date)],
    ["Birthplace", p.birth_place],
    ["Died", formatDate(p.death_date)],
    ["Notes", p.notes],
  ].filter(([, v]) => v);
  const photo = photoEditor(id);
  const box = el(
    "div",
    { id: "card", role: "dialog", "aria-label": p.name },
    el("div", { class: "top" }, photo.circle, el("div", { class: "who" }, el("h2", {}, displayName(id)), photo.label)),
    el("div", { class: "person-editing" }, familySite?.personActions(id)),
    el("div", { class: "details-body", id: "details-body" },
      facts.length ? el("dl", { class: "person-facts" }, ...facts.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])) : null,
      group("Parents", parentsOf(tree, id)),
      group(partners.length > 1 ? "Partners" : "Partner", partners, (o) => partnerNote(id, o)),
      group("Siblings", siblings(tree, id), (o) => (halfSiblings(tree, id, o) ? "Half" : "")),
      group("Children", children(tree, id)),
      p.other_trees?.length ? el("section", {}, el("h3", {}, "Other trees"),
        ...p.other_trees.map((other) => el("a", {
          class: "relative tree-link", href: apiUrl(`/t/${other.short_id}#${p.short_id}`),
        }, other.name)),
      ) : null,
      related.size === 1 ? el("p", { class: "none" }, "No family recorded yet.") : null,
    ),
    el("div", { class: "actions" }, compare, link, familySite?.suggestionAction(id)),
  );
  photoCleanups.set(box, photo.cleanup);
  const shut = el("button", { class: "close", "aria-label": "Close" });
  shut.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  shut.onclick = close;
  const expand = el("button", { class: "sheet-toggle", "aria-expanded": "false", "aria-controls": "details-body" }, "Expand details");
  expand.onclick = () => {
    const expanded = box.classList.toggle("expanded");
    expand.setAttribute("aria-expanded", String(expanded));
    expand.textContent = expanded ? "Collapse details" : "Expand details";
    if (comparison?.to || !inView(frame)) centreOn(frame, { fitAll: Boolean(comparison?.to) });
  };
  box.querySelector(".top").after(expand);
  box.append(shut);
  $("view").append(box);
  if (comparison) renderComparison(box);
  if (comparison?.to && matchMedia("(max-width: 640px)").matches) {
    box.classList.add("expanded");
    expand.setAttribute("aria-expanded", "true");
    expand.textContent = "Collapse details";
  }

  // Details respond immediately while the camera glides to the selected family.
  const comparing = Boolean(comparison?.to);
  const frame = comparing ? comparisonFrame() : comparison ? [id] : [id, ...up, ...children(tree, id), ...partners];
  if (comparing || !inView(frame)) centreOn(frame, { fitAll: comparing });
  if (comparison?.to) {
    highlightComparison();
    box.querySelector(".compare-summary").focus({ preventScroll: true });
  }
  history.replaceState(null, "", `#${person(id).short_id}`);
}
document.addEventListener("family-person-select", event => { if (event instanceof CustomEvent) select(event.detail); });
function clear() {
  photoCleanups.get($("card"))?.();
  $("card")?.remove();
  for (const id of ids) cards[id].classList.remove("selected");
  unhighlight();
}
function unhighlight() {
  for (const { path } of edges) path.classList.remove("on");
}
function close() {
  resetComparison();
  clear();
  selected = null;
  updateListSelection();
  stage.classList.remove("dim");
  history.replaceState(null, "", location.pathname);
}
stage.addEventListener("click", (e) => {
  if (moved) return;
  const node = (e.target instanceof Element ? (e.target instanceof Element ? e.target : document.body).closest(".person") : null);
  node instanceof HTMLElement ? select(node.dataset.id) : close();
});
view.addEventListener("click", (e) => { if (!moved && e.target === view) close(); });
addEventListener("keydown", (e) => { if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("dialog[open]")) close(); });

// Search

const search = $("search");
const listRows = new Map();
const alphabetical = [...ids].sort((a, b) => displayName(a).localeCompare(displayName(b), undefined, { sensitivity: "base", numeric: true }) || a.localeCompare(b));
for (const id of alphabetical) {
  const row = el("button", { class: "directory-person", "data-id": id, "aria-pressed": "false" },
    avatar(id), el("span", { class: "directory-text" }, el("span", { class: "name" }, displayName(id)),
      years(person(id)) && el("span", { class: "years" }, years(person(id)))));
  row.onclick = () => select(id);
  listRows.set(id, row);
}
function updateListSelection() {
  for (const [id, row] of listRows) row.setAttribute("aria-pressed", String(id === selected));
}
function renderPeopleList(terms = []) {
  const visible = alphabetical.filter(id => terms.every(term => displayName(id).toLowerCase().includes(term)));
  $("people-list").replaceChildren(el("div", { class: "directory" },
    ...visible.map(id => { const row = listRows.get(id); paint(row.querySelector("[data-avatar]")); return row; }),
    !visible.length ? el("p", { class: "directory-empty", role: "status" }, ids.length ? "No one by that name" : "This family tree is empty.") : null));
  return visible;
}
const results = $("results");
let matches = [];
let active = 0;
function activateResult(index) {
  active = index;
  [...results.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === active)));
  const item = matches.length && results.children[active];
  if (item) search.setAttribute("aria-activedescendant", item.id);
  else search.removeAttribute("aria-activedescendant");
}
function showResults() {
  const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean);
  if (listMode) {
    matches = renderPeopleList(terms);
    active = 0;
    results.hidden = true;
    search.removeAttribute("aria-expanded");
    search.removeAttribute("aria-activedescendant");
    return;
  }
  const name = (id) => person(id).name.toLowerCase();
  const starts = (id) => name(id).split(/\s+/).some((w) => w.startsWith(terms[0]));
  matches = terms.length
    ? ids.filter((id) => !PLACEHOLDER.test(person(id).name) && terms.every((t) => name(id).includes(t)))
        .sort((a, b) => starts(b) - starts(a)).slice(0, 8)
    : [];
  results.replaceChildren(
    ...(matches.length
      ? matches.map((id, i) => {
          const item = el("li", { id: `search-result-${i}`, role: "option", "aria-selected": String(i === active) }, avatar(id), el("span", {}, el("span", { class: "name" }, person(id).name), years(person(id)) && el("span", { class: "years" }, years(person(id)))));
          item.onpointerenter = () => activateResult(i);
          item.onpointerdown = (e) => { e.preventDefault(); choose(id); };
          return item;
        })
      : [el("li", { class: "empty" }, "No one by that name")]),
  );
  activateResult(0);
  results.hidden = !terms.length;
  search.setAttribute("aria-expanded", String(!results.hidden));
}
function choose(id) {
  if (!listMode) search.value = "";
  results.hidden = true;
  if (!listMode) search.setAttribute("aria-expanded", "false");
  search.removeAttribute("aria-activedescendant");
  search.blur();
  select(id);
}
search.addEventListener("input", showResults);
search.addEventListener("blur", () => { results.hidden = true; });
search.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (listMode) {
      if (matches.length) listRows.get(matches[e.key === "ArrowUp" ? matches.length - 1 : 0]).focus();
      return;
    }
    activateResult((active + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % Math.max(1, matches.length));
  } else if (e.key === "Enter" && matches[active]) choose(matches[active]);
  else if (e.key === "Escape") { search.value = ""; showResults(); }
});

renderPeopleList();
if (!ids.length) stage.append(el("div", { class: "empty-tree" }, "This family tree is empty."));
else {
  // Start at a readable scale. The full graph remains available by panning or Show everyone.
  const roots = ids.filter((id) => !parentsOf(tree, id).length);
  const anchor = (roots.length ? roots : ids).reduce((a, b) => children(tree, b).length > children(tree, a).length ? b : a);
  camera.scale = 0.8;
  camera.x = view.clientWidth / 2 - (at(anchor).x + card.w / 2) * camera.scale;
  camera.y = 24 - at(anchor).y * camera.scale;
  apply();
  const start = ids.find(id => person(id).short_id === location.hash.slice(1));
  if (location.hash && !start) history.replaceState(null, "", location.pathname);
  if (tree.people[start]) {
    select(start);
    stage.getAnimations().forEach(animation => animation.finish());
  }
  try {
    const saved = JSON.parse(sessionStorage.getItem(viewKey) || "null");
    sessionStorage.removeItem(viewKey);
    if (saved?.id === start && [saved.scale, saved.x, saved.y].every(Number.isFinite) && saved.scale > 0) {
      if (saved.expanded && !$("card").classList.contains("expanded")) /** @type {HTMLButtonElement} */ ($("card").querySelector(".sheet-toggle")).click();
      camera.scale = saved.scale;
      camera.x = saved.x * view.clientWidth - at(start).x * saved.scale;
      camera.y = saved.y * view.clientHeight - at(start).y * saved.scale;
      apply(); stage.getAnimations().forEach(animation => animation.finish());
    }
  } catch {}
}
})().catch((error) => {
  console.error("Unable to lay out family tree", error);
  document.getElementById("view").replaceChildren(Object.assign(document.createElement("p"), {
    className: "empty-tree", textContent: "The family tree could not be displayed. Please reload to try again.",
  }));
});
