(async () => {
const tree = JSON.parse(document.getElementById("tree-data").textContent);
const ids = Object.keys(tree.people);
const $ = (id) => document.getElementById(id);
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
  if (!event.target.closest(".tree-picker")) closeTreeOptions();
});
document.addEventListener("focusin", (event) => {
  if (!event.target.closest(".tree-picker")) closeTreeOptions();
});
document.querySelector(".tree-picker").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeTreeOptions();
    treeSwitch.focus();
    event.preventDefault();
  } else if (["ArrowDown", "ArrowUp"].includes(event.key)) {
    const links = [...treeOptions.querySelectorAll("a")];
    const index = links.indexOf(document.activeElement);
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
    if (document.activeElement === document.body) focus?.focus({ preventScroll: true });
  }
}
$("share-tree").onclick = () => shareLink($("share-tree"), `${tree.name} · ${tree.site_name}`, location.href.split("#")[0]);

// Tree

let direction = "DOWN";
try { if (localStorage.getItem("tree-layout") === "RIGHT") direction = "RIGHT"; } catch {}
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
for (const e of connections(geometry, PAD)) {
  edge(e);
}

// Pan and zoom

const camera = { x: 0, y: 0, scale: 1 };
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
function centreOn([id, ...group]) {
  const b = bounds([id, ...group]);
  const { w, h } = room();
  const scale = Math.max(0.6, Math.min(camera.scale, 1, (w - 48) / b.w, (h - 48) / b.h));
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
  if (e.target.closest("#card, .zoom, .ask-open")) return;
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

function updateLayoutButtons() {
  $("layout-down").setAttribute("aria-pressed", String(direction === "DOWN"));
  $("layout-right").setAttribute("aria-pressed", String(direction === "RIGHT"));
}
async function switchLayout(next) {
  if (next === direction) return;
  const buttons = [$("layout-down"), $("layout-right")];
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
      highlight(selected);
      const p = at(selected);
      camera.x = view.clientWidth / 2 - (p.x + card.w / 2) * camera.scale;
      camera.y = view.clientHeight / 2 - (p.y + card.h / 2) * camera.scale;
      apply();
    } else fit();
    updateLayoutButtons();
    try { localStorage.setItem("tree-layout", direction); } catch {}
  } catch (error) {
    console.error("Unable to switch tree layout", error);
  } finally {
    buttons.forEach((button) => button.disabled = false);
  }
}
$("layout-down").onclick = () => switchLayout("DOWN");
$("layout-right").onclick = () => switchLayout("RIGHT");
updateLayoutButtons();

// Person card

let selected = null;
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

function select(id) {
  hideAsk();
  clear();
  selected = id;
  const p = person(id);
  const partners = partnersOf(tree, id);
  const up = parentsOf(tree, id);
  const related = highlight(id);
  const link = el("button", { class: "action" }, "Share person");
  link.onclick = () => shareLink(link, `${displayName(id)} · ${tree.name}`, `${location.href.split("#")[0]}#${id}`);
  const facts = [
    ["Born", [p.birth_date, p.birth_place && `in ${p.birth_place}`].filter(Boolean).join(" ")],
    ["Died", p.death_date],
  ].filter(([, v]) => v);
  const photo = photoEditor(id);
  const box = el(
    "div",
    { id: "card", role: "dialog", "aria-label": p.name },
    el("div", { class: "top" }, photo.circle, el("div", { class: "who" }, el("h2", {}, displayName(id)), lifespan(p) && el("span", { class: "years" }, lifespan(p)))),
    el("div", { class: "details-body", id: "details-body" },
      facts.length ? el("dl", {}, ...facts.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])) : null,
      photo.panel,
      p.notes && el("p", { class: "notes" }, p.notes),
      p.private && el("p", { class: "none" }, "Details are hidden for living people."),
      group("Parents", parentsOf(tree, id)),
      group(partners.length > 1 ? "Partners" : "Partner", partners, (o) => partnerNote(id, o)),
      group("Siblings", siblings(tree, id), (o) => (halfSiblings(tree, id, o) ? "Half" : "")),
      group("Children", children(tree, id)),
      p.other_trees?.length ? el("section", {}, el("h3", {}, "Other trees"),
        ...p.other_trees.map((other) => el("a", {
          class: "relative tree-link", href: `/trees/${other.id}/#${id}`,
        }, other.name)),
      ) : null,
      related.size === 1 ? el("p", { class: "none" }, "No family recorded yet.") : null,
    ),
    el("div", { class: "actions" }, link),
  );
  const shut = el("button", { class: "close", "aria-label": "Close" });
  shut.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  shut.onclick = close;
  const expand = el("button", { class: "sheet-toggle", "aria-expanded": "false", "aria-controls": "details-body" }, "Expand details");
  expand.onclick = () => {
    const expanded = box.classList.toggle("expanded");
    expand.setAttribute("aria-expanded", String(expanded));
    expand.textContent = expanded ? "Collapse details" : "Expand details";
    if (!inView(frame)) centreOn(frame);
  };
  box.querySelector(".top").after(expand);
  box.append(shut);
  $("view").append(box);

  // While the tree glides to the person, the card waits at its final spot and appears on arrival.
  const frame = [id, ...up, ...children(tree, id), ...partners];
  if (!inView(frame)) {
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
  history.replaceState(null, "", `#${id}`);
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
addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  askPanel && !askPanel.hidden ? closeAsk() : close();
});

// Search

const search = $("search");
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
  search.value = "";
  results.hidden = true;
  search.setAttribute("aria-expanded", "false");
  search.removeAttribute("aria-activedescendant");
  search.blur();
  select(id);
}
search.addEventListener("input", showResults);
search.addEventListener("blur", () => { results.hidden = true; });
search.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    activateResult((active + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % Math.max(1, matches.length));
  } else if (e.key === "Enter" && matches[active]) choose(matches[active]);
  else if (e.key === "Escape") { search.value = ""; showResults(); }
});

// Ask: questions about the family, answered by Claude through the site's /api/ask function. It
// appears only on published sites whose owner has stored an API key.

const ASKED = `ask:${tree.id}`;
let askPanel = null;
let askLog = [];
try { askLog = JSON.parse(sessionStorage.getItem(ASKED)) || []; } catch {}
function hideAsk() {
  if (!askPanel || askPanel.hidden) return;
  askPanel.hidden = true;
  $("ask-open").hidden = false;
}
function closeAsk() {
  hideAsk();
  close();
  $("ask-open").focus();
}
// A name in an answer lights up that person in the tree and keeps the conversation open.
function peek(id) {
  if (selected) cards[selected].classList.remove("selected");
  selected = id;
  highlight(id);
  const frame = [id, ...parentsOf(tree, id), ...children(tree, id), ...partnersOf(tree, id)];
  if (!inView(frame)) centreOn(frame);
  history.replaceState(null, "", `#${id}`);
}
// Answers are plain text with "- " lists and [Name](#id) links; nothing is parsed as HTML.
function inline(text) {
  const parts = [];
  const pattern = /\[([^\]\n]+)\]\(#([0-9a-f-]{36})\)|\*\*([^*\n]+)\*\*/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    parts.push(text.slice(last, match.index));
    last = match.index + match[0].length;
    const [, label, id, bold] = match;
    if (bold) parts.push(el("strong", {}, ...inline(bold)));
    else if (!tree.people[id]) parts.push(label);
    else {
      const link = el("button", { class: "person-link", type: "button" }, label);
      link.onclick = () => peek(id);
      parts.push(link);
    }
  }
  parts.push(text.slice(last));
  return parts;
}
// Runs of "- " lines become a list; other lines join into paragraphs split by blank lines.
function rendered(text) {
  const blocks = [];
  let block = null;
  for (const line of text.split("\n")) {
    const item = line.match(/^\s*[-•*]\s+(.*)$/);
    if (!line.trim()) block = null;
    else if (item) {
      if (block?.tagName !== "UL") blocks.push((block = el("ul")));
      block.append(el("li", {}, ...inline(item[1])));
    } else {
      if (block?.tagName === "P") block.append(el("br"));
      else blocks.push((block = el("p")));
      block.append(...inline(line));
    }
  }
  return blocks;
}
// Starter questions from this family: a long chain of names, someone's grandchildren, the eldest.
function examples() {
  const grand = (id) => [...new Set(children(tree, id).flatMap((c) => children(tree, c)))];
  const known = ids.filter((id) => !PLACEHOLDER.test(person(id).name));
  const depths = new Map();
  const depth = (id) => {
    if (!depths.has(id)) depths.set(id, parentsOf(tree, id).length ? 1 + Math.max(...parentsOf(tree, id).map(depth)) : 0);
    return depths.get(id);
  };
  const youngest = [...known].sort((a, b) => depth(b) - depth(a) || (year(person(b).birth_date) || "").localeCompare(year(person(a).birth_date) || ""))[0];
  const questions = [];
  if (youngest && depth(youngest) >= 2) {
    const grandparents = parentsOf(tree, youngest).flatMap((p) => parentsOf(tree, p));
    const far = grandparents.flatMap((g) => siblings(tree, g)).concat(grandparents).find((o) => !PLACEHOLDER.test(person(o).name));
    if (far) questions.push(`How is ${person(youngest).name} related to ${person(far).name}?`);
  }
  const elder = known.filter((id) => grand(id).length).sort((a, b) => grand(b).length - grand(a).length)[0];
  if (elder) questions.push(`Who are ${person(elder).name}'s grandchildren?`);
  if (known.some((id) => person(id).birth_date)) questions.push("Who is the oldest person in the tree?");
  return questions.slice(0, 3);
}
function setUpAsk() {
  const open = el("button", { class: "ask-open", id: "ask-open", type: "button", "aria-controls": "ask" });
  open.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.8 7L4 20l1-5.2A8 8 0 1 1 21 12Z"/></svg><span>Ask about the family</span>';
  const log = el("div", { class: "ask-log", role: "log", "aria-live": "polite" });
  const input = el("textarea", { rows: "1", maxlength: "500", placeholder: "Ask a question…", "aria-label": "Your question", enterkeyhint: "send" });
  const send = el("button", { class: "ask-send", type: "submit", "aria-label": "Send" });
  send.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg>';
  const form = el("form", { class: "ask-form" }, input, send);
  const shut = el("button", { class: "close", type: "button", "aria-label": "Close" });
  shut.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  shut.onclick = closeAsk;
  askPanel = el("aside", { id: "ask", "aria-label": "Ask about the family", hidden: "" },
    el("div", { class: "ask-head" }, el("h2", {}, "Ask about the family"), shut),
    log, form, el("p", { class: "ask-note" }, "Answered by Claude from this tree. It can make mistakes."));
  $("view").append(askPanel);
  view.append(open);

  let waiting = false;
  const save = () => { try { sessionStorage.setItem(ASKED, JSON.stringify(askLog)); } catch {} };
  const bubble = (role, content) => el("div", { class: `msg ${role}` }, ...(role === "user" ? [content] : rendered(content)));
  function draw() {
    const start = askLog.length ? [] : [
      el("p", { class: "ask-intro" }, `Ask anything about the people in ${tree.name}: who they are, how they're related, or when they were born.`),
      el("div", { class: "ask-examples" }, ...examples().map((q) => {
        const chip = el("button", { type: "button", class: "chip" }, q);
        chip.onclick = () => ask(q);
        return chip;
      })),
    ];
    log.replaceChildren(...start, ...askLog.map((m) => bubble(m.role, m.content)));
  }
  async function ask(question) {
    question = question.trim();
    if (!question || waiting) return;
    waiting = true;
    send.disabled = true;
    input.value = "";
    input.style.height = "";
    if (!askLog.length) log.replaceChildren();
    const thinking = el("div", { class: "msg assistant thinking" }, el("span", { class: "dots", "aria-label": "Thinking" }, el("i"), el("i"), el("i")));
    log.append(bubble("user", question), thinking);
    log.scrollTop = log.scrollHeight;
    const messages = [...askLog.slice(-8), { role: "user", content: question }];
    let failure = "Couldn't connect. Check your connection and try again.";
    try {
      const response = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tree: tree.id, messages }) });
      const reply = await response.json().catch(() => ({}));
      if (response.ok && reply.answer) {
        askLog.push({ role: "user", content: question }, { role: "assistant", content: reply.answer });
        save();
        thinking.replaceWith(bubble("assistant", reply.answer));
        failure = "";
      } else failure = reply.error || "Ask couldn't answer right now. Try again in a minute.";
    } catch {}
    if (failure) {
      const retry = el("button", { type: "button", class: "chip" }, "Try again");
      retry.onclick = () => {
        retry.parentElement.previousElementSibling?.remove();
        retry.parentElement.remove();
        ask(question);
      };
      thinking.replaceWith(el("div", { class: "msg assistant error" }, el("p", {}, failure), retry));
    }
    waiting = false;
    send.disabled = false;
    log.scrollTop = log.scrollHeight;
  }
  form.onsubmit = (event) => {
    event.preventDefault();
    ask(input.value);
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      ask(input.value);
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  });
  open.onclick = () => {
    close();
    askPanel.hidden = false;
    open.hidden = true;
    draw();
    log.scrollTop = log.scrollHeight;
    input.focus({ preventScroll: true });
  };
}
fetch("/api/ask")
  .then((response) => (response.ok ? response.json() : {}))
  .then((status) => { if (status.enabled && ids.length) setUpAsk(); })
  .catch(() => {});

if (!ids.length) view.replaceChildren(el("div", { class: "empty-tree" }, "This family tree is empty."));
else {
  // Start at a readable scale. The full graph remains available by panning or Show everyone.
  const roots = ids.filter((id) => !parentsOf(tree, id).length);
  const anchor = (roots.length ? roots : ids).reduce((a, b) => children(tree, b).length > children(tree, a).length ? b : a);
  camera.scale = 0.8;
  camera.x = view.clientWidth / 2 - (at(anchor).x + card.w / 2) * camera.scale;
  camera.y = 24 - at(anchor).y * camera.scale;
  apply();
  const start = decodeURIComponent(location.hash.slice(1));
  if (tree.people[start]) select(start);
}
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
