(async () => {
const tree = JSON.parse(document.getElementById("tree-data").textContent);
const ids = Object.keys(tree.people);
const $ = (id) => document.getElementById(id);
const view = $("view");
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
// "1915–1998 · 83 years" when both years are known.
function lifespan(p) {
  const [born, died] = [p.birth_date, p.death_date].map((d) => Number(d?.match(/\d{4}/)?.[0]));
  return born && died && died >= born ? `${years(p)} · ${died - born} years` : "";
}
function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k === "class" ? (node.className = v) : node.setAttribute(k, v);
  node.append(...kids.filter((k) => k != null && k !== ""));
  return node;
}
// Photos: shown wherever a person's initials are, and changed from their card with the family
// code. Only published sites have them, served by the site's /api/photos function.
const PHOTOS = Boolean(tree.photos);
let photos = {}; // person id -> photo version
function paint(circle) {
  circle.querySelector("img")?.remove();
  const id = circle.dataset.avatar;
  if (!photos[id]) return;
  const img = el("img", { src: `/api/photos/${id}?v=${photos[id]}`, alt: "", decoding: "async" });
  img.onerror = () => img.remove();
  circle.append(img);
}
const repaint = (id) => document.querySelectorAll(`[data-avatar="${id}"]`).forEach(paint);
function avatar(id, size = "") {
  const circle = el("span", { class: `avatar ${size}`, "aria-hidden": "true", "data-avatar": id }, initials(id));
  paint(circle);
  return circle;
}

$("theme").onclick = () => {
  const dark = document.documentElement.dataset.theme !== "dark";
  dark ? (document.documentElement.dataset.theme = "dark") : delete document.documentElement.dataset.theme;
  try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch {}
};
$("title").textContent = tree.name;
$("count").textContent = `${ids.length} ${ids.length === 1 ? "person" : "people"}`;
document.title = tree.name;

// Tree

const geometry = await layout(tree);
const { pos, card, width, height } = geometry;
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
    class: `person${PLACEHOLDER.test(p.name) ? " unknown" : ""}`,
    "data-id": id, "aria-label": `${p.name}${caption ? `, ${caption}` : ""}`,
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
for (const e of connections(tree, geometry, PAD)) {
  edge(e);
}

// Pan and zoom

const camera = { x: 0, y: 0, scale: 1 };
function apply(glide = false) {
  stage.classList.toggle("glide", glide);
  stage.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
  place();
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
// The part of the screen left free by the person's card: the top on phones, the left otherwise.
function room() {
  const narrow = matchMedia("(max-width: 640px)").matches;
  const sheet = narrow ? $("card")?.offsetHeight || view.clientHeight * 0.55 : 0;
  return { w: view.clientWidth * (narrow ? 1 : 0.68), h: Math.max(120, view.clientHeight - sheet) };
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
function centreOn([id, ...group]) {
  const b = bounds([id, ...group]);
  const { w, h } = room();
  const scale = Math.max(0.6, Math.min(1, (w - 48) / b.w, (h - 48) / b.h));
  camera.scale = scale;
  camera.x = w / 2 - (b.x + b.w / 2) * scale;
  // Leave room below the selection for relatives and the details panel.
  camera.y = Math.min(h / 2 - (b.y + b.h / 2) * scale, 64 - b.y * scale);
  // When the whole line can't fit at a readable size, keep the person in view.
  const p = at(id);
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  camera.x = clamp(camera.x, 24 - p.x * scale, w - 24 - (p.x + card.w) * scale);
  camera.y = clamp(camera.y, 24 - p.y * scale, h - 24 - (p.y + card.h) * scale);
  const before = stage.style.transform;
  apply(true);
  return stage.style.transform !== before;
}

const pointers = new Map();
let moved = false;
let pinch = null;
view.addEventListener("pointerdown", (e) => {
  if (e.target.closest("#card, .zoom")) return;
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
  if (e.target.closest("#card")) return;
  e.preventDefault();
  const box = view.getBoundingClientRect();
  zoomAt(camera.scale * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - box.left, e.clientY - box.top);
}, { passive: false });
$("zoom-in").onclick = () => zoomAt(camera.scale * 1.3, undefined, undefined, true);
$("zoom-out").onclick = () => zoomAt(camera.scale / 1.3, undefined, undefined, true);
$("zoom-fit").onclick = () => { close(); fit(true); };

// Person card

let selected = null;
// Each relative's years tell apart people who share a name.
function relativeRow(id, note = "") {
  const side = [note, years(person(id))].filter(Boolean).join(" · ");
  const row = el("button", { class: "relative" }, el("span", { class: "name" }, displayName(id)), side && el("span", { class: "note" }, side));
  row.onclick = () => select(id, true);
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

const walk = (start, step) => {
  const seen = new Set();
  const queue = [start];
  while (queue.length) for (const next of step(queue.shift())) if (!seen.has(next)) seen.add(next) && queue.push(next);
  return seen;
};

// The family code is kept on this device once it works.
const CODE = "family-tree-photo-code";
const savedCode = () => {
  try { return localStorage.getItem(CODE) || ""; } catch { return ""; }
};
function saveCode(code) {
  try { code ? localStorage.setItem(CODE, code) : localStorage.removeItem(CODE); } catch {}
}
async function send(method, id = "", body = null) {
  const headers = { "x-edit-code": savedCode() };
  if (body) headers["content-type"] = body.type;
  const response = await fetch(`/api/photos${id && `/${id}`}`, { method, headers, body });
  if (response.status === 403) saveCode("");
  return response;
}
// Phones take large photos, so upload a 512px square crop from the middle.
async function square(file) {
  const image = await createImageBitmap(file);
  const side = Math.min(image.width, image.height);
  const size = Math.min(512, side);
  const canvas = el("canvas", { width: size, height: size });
  canvas.getContext("2d").drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, size, size);
  return new Promise((done, fail) => canvas.toBlob((blob) => (blob ? done(blob) : fail(new Error())), "image/jpeg", 0.85));
}
const errorOf = async (response) => (await response.json().catch(() => ({}))).error || "Something went wrong. Try again.";

// The big circle in a person's card: tap it to add, change or remove their photo.
function photoEditor(id) {
  const circle = avatar(id, "lg");
  if (!PHOTOS || PLACEHOLDER.test(person(id).name)) return { circle, panel: null };
  const badge = el("span", { class: "badge", "aria-hidden": "true" });
  badge.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/></svg>';
  const button = el("button", { class: "photo", "aria-label": "Photo", "aria-expanded": "false" }, circle, badge);
  const panel = el("div", { class: "photo-panel", hidden: "" });
  const picker = el("input", { type: "file", accept: "image/*", hidden: "" });
  const show = (...kids) => {
    panel.replaceChildren(...kids.filter(Boolean), picker);
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
  };
  const hide = () => {
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };
  const note = (text, error = false) => text && el("p", { class: `status${error ? " error" : ""}` }, text);

  function menu(message = "", error = false) {
    const choose = el("button", { class: "action" }, photos[id] ? "Change photo" : "Add photo");
    choose.onclick = () => (savedCode() ? picker.click() : askCode(menu));
    const remove = photos[id] && el("button", { class: "action" }, "Remove photo");
    if (remove) {
      remove.onclick = () => {
        if (!remove.dataset.sure) return Object.assign(remove.dataset, { sure: "1" }), (remove.textContent = "Tap again to remove");
        savedCode() ? removePhoto() : askCode(removePhoto);
      };
    }
    show(note(message, error), el("div", { class: "row" }, choose, remove));
  }
  // Asks once per device. Phones only open the photo picker straight from a tap, so after the
  // code is accepted the person taps Add photo again.
  function askCode(then, message = "") {
    const input = el("input", { type: "text", placeholder: "Family code", autocomplete: "off", autocapitalize: "none", spellcheck: "false", "aria-label": "Family code" });
    const go = el("button", { class: "action primary", type: "submit" }, "Continue");
    const form = el("form", {}, el("p", { class: "status" }, "Enter the family code to change photos."), el("div", { class: "row" }, input, go), note(message, true));
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (!input.value.trim()) return;
      saveCode(input.value.trim().toLowerCase());
      go.disabled = true;
      const response = await send("POST").catch(() => null);
      if (response?.status === 204) then === menu ? menu("Code saved on this device.") : then();
      else askCode(then, response?.status === 403 ? "That code isn't right." : "Couldn't connect. Try again.");
    };
    show(form);
    input.focus();
  }
  async function removePhoto() {
    show(note("Removing…"));
    const response = await send("DELETE", id).catch(() => null);
    if (response?.ok) {
      delete photos[id];
      repaint(id);
      return hide();
    }
    response?.status === 403 ? askCode(removePhoto, "That code isn't right.") : menu(response ? await errorOf(response) : "Couldn't connect. Try again.", true);
  }
  picker.onchange = async () => {
    const chosen = picker.files[0];
    picker.value = "";
    if (!chosen) return;
    show(note("Uploading…"));
    let body;
    try {
      body = await square(chosen);
    } catch {
      return menu("Couldn't read that image. Try a JPEG or PNG.", true);
    }
    const response = await send("PUT", id, body).catch(() => null);
    if (response?.ok) {
      photos[id] = (await response.json()).v;
      repaint(id);
      return hide();
    }
    response?.status === 403 ? askCode(menu, "That code isn't right.") : menu(response ? await errorOf(response) : "Couldn't connect. Try again.", true);
  };
  button.onclick = () => (panel.hidden ? menu() : hide());
  return { circle: button, panel };
}

// Lights up someone's line from the oldest ancestors down to their children (or, with branch,
// all their descendants) and fades everyone who isn't close family.
function highlight(id) {
  unhighlight();
  const partners = partnersOf(tree, id);
  const down = new Set(children(tree, id));
  const line = new Set([id, ...walk(id, (x) => parentsOf(tree, x)), ...down]);
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

function select(id, glide = false) {
  clear();
  selected = id;
  const p = person(id);
  const partners = partnersOf(tree, id);
  const up = walk(id, (x) => parentsOf(tree, x));
  const related = highlight(id);
  const link = el("button", { class: "action" }, "Copy link");
  link.onclick = async () => {
    const url = `${location.href.split("#")[0]}#${id}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Older browsers: copy through a hidden field.
      const field = el("textarea", { readonly: "", style: "position:fixed;opacity:0" });
      field.value = url;
      document.body.append(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    link.textContent = "Link copied";
    setTimeout(() => (link.textContent = "Copy link"), 1500);
  };
  const facts = [
    ["Born", [p.birth_date, p.birth_place && `in ${p.birth_place}`].filter(Boolean).join(" ")],
    ["Died", p.death_date],
  ].filter(([, v]) => v);
  const photo = photoEditor(id);
  const box = el(
    "div",
    { id: "card", role: "dialog", "aria-label": p.name },
    el("div", { class: "top" }, photo.circle, el("div", { class: "who" }, el("h2", {}, displayName(id)), lifespan(p) && el("span", { class: "years" }, lifespan(p)))),
    facts.length ? el("dl", {}, ...facts.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])) : null,
    photo.panel,
    p.notes && el("p", { class: "notes" }, p.notes),
    p.private && el("p", { class: "none" }, "Details are hidden for living people."),
    group("Parents", parentsOf(tree, id)),
    group(partners.length > 1 ? "Partners" : "Partner", partners, (o) => partnerNote(id, o)),
    group("Siblings", siblings(tree, id), (o) => (halfSiblings(tree, id, o) ? "Half" : "")),
    group("Children", children(tree, id)),
    related.size === 1 ? el("p", { class: "none" }, "No family recorded yet.") : null,
    el("div", { class: "actions" }, link),
  );
  const shut = el("button", { class: "close", "aria-label": "Close" });
  shut.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  shut.onclick = close;
  box.append(shut);
  view.append(box);

  // While the tree glides to the person, the card waits at its final spot and appears on arrival.
  const frame = [id, ...up, ...children(tree, id), ...partners];
  if (glide || !inView(frame)) {
    box.classList.add("waiting");
    const show = () => {
      box.classList.remove("waiting");
      stage.removeEventListener("transitionend", arrived);
    };
    // Cards fade too; only the stage's own move counts as arriving.
    const arrived = (e) => e.target === stage && e.propertyName === "transform" && show();
    if (centreOn(frame)) {
      stage.addEventListener("transitionend", arrived);
      setTimeout(show, 600);
    } else show();
  }
  place();
  history.replaceState(null, "", `#${id}`);
}
// Positions come from the camera, not the DOM, so the card never reads a half-finished glide.
function place() {
  const box = $("card");
  if (!box || !selected || matchMedia("(max-width: 640px)").matches) return;
  const { x, y } = at(selected);
  const s = camera.scale;
  const [left, top, w] = [camera.x + x * s, camera.y + y * s, card.w * s];
  const [vw, vh, bw, bh] = [view.clientWidth, view.clientHeight, box.offsetWidth, box.offsetHeight];
  const right = left + w + 12;
  const side = right + bw > vw - 16 ? left - bw - 12 : right;
  box.style.left = `${Math.min(Math.max(16, side), vw - bw - 16)}px`;
  box.style.top = `${Math.min(Math.max(16, top), vh - bh - 16)}px`;
}
function clear() {
  $("card")?.remove();
  if (selected) cards[selected].classList.remove("selected");
  unhighlight();
}
function unhighlight() {
  for (const { path } of edges) path.classList.remove("on");
}
function close() {
  clear();
  selected = null;
  stage.classList.remove("dim");
  history.replaceState(null, "", location.pathname);
}
stage.addEventListener("click", (e) => {
  if (moved) return;
  const node = e.target.closest(".person");
  node ? select(node.dataset.id) : close();
});
view.addEventListener("click", (e) => { if (!moved && e.target === view) close(); });
addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
addEventListener("resize", place);

// Search

const search = $("search");
const results = $("results");
let matches = [];
let active = 0;
function showResults() {
  const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean);
  const name = (id) => person(id).name.toLowerCase();
  const starts = (id) => name(id).split(/\s+/).some((w) => w.startsWith(terms[0]));
  matches = terms.length
    ? ids.filter((id) => !PLACEHOLDER.test(person(id).name) && terms.every((t) => name(id).includes(t)))
        .sort((a, b) => starts(b) - starts(a)).slice(0, 8)
    : [];
  active = 0;
  results.replaceChildren(
    ...(matches.length
      ? matches.map((id, i) => {
          const item = el("li", { role: "option", "aria-selected": String(i === active) }, avatar(id), el("span", {}, el("span", { class: "name" }, person(id).name), years(person(id)) && el("span", { class: "years" }, years(person(id)))));
          item.onpointerdown = (e) => { e.preventDefault(); choose(id); };
          return item;
        })
      : [el("li", { class: "empty" }, "No one by that name")]),
  );
  results.hidden = !terms.length;
  search.setAttribute("aria-expanded", String(!results.hidden));
}
function choose(id) {
  search.value = "";
  results.hidden = true;
  search.setAttribute("aria-expanded", "false");
  search.blur();
  select(id, true);
}
search.addEventListener("input", showResults);
search.addEventListener("blur", () => { results.hidden = true; });
search.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    active = (active + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % Math.max(1, matches.length);
    [...results.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === active)));
  } else if (e.key === "Enter" && matches[active]) choose(matches[active]);
  else if (e.key === "Escape") { search.value = ""; showResults(); }
});

if (!ids.length) view.replaceChildren(el("div", { class: "empty-tree" }, "This family tree is empty."));
else {
  // Start at a readable scale. The full graph remains available by panning or Show everyone.
  const roots = ids.filter((id) => !parentsOf(tree, id).length);
  const anchor = (roots.length ? roots : ids).reduce((a, b) => children(tree, b).length > children(tree, a).length ? b : a);
  camera.scale = 0.8;
  camera.x = 24 - at(anchor).x * camera.scale;
  camera.y = view.clientHeight / 2 - (at(anchor).y + card.h / 2) * camera.scale;
  apply();
  const start = decodeURIComponent(location.hash.slice(1));
  if (tree.people[start]) select(start, true);
}
// Resizing changes the viewport, never the graph or the current zoom.
if (PHOTOS) {
  fetch("/api/photos")
    .then((response) => (response.ok ? response.json() : {}))
    .then((found) => {
      photos = found;
      Object.keys(found).forEach(repaint);
    })
    .catch(() => {});
}
})().catch((error) => {
  console.error("Unable to lay out family tree", error);
  document.getElementById("view").replaceChildren(Object.assign(document.createElement("p"), {
    className: "empty-tree", textContent: "The family tree could not be displayed. Please reload to try again.",
  }));
});
