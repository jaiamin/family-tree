(async () => {
const tree = await window.familySite.loadTree();
const apiUrl = path => window.familySite.base + path;
const treeUrl = new URL(apiUrl(`/trees/${tree.id}`), location.origin).href;
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
let photos = {}; // person id -> photo version
function paint(circle) {
  circle.querySelector("img")?.remove();
  const id = circle.dataset.avatar;
  if (!photos[id]) return;
  const img = el("img", { src: apiUrl(`/api/photos/${id}?v=${photos[id]}`), alt: "", decoding: "async" });
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
$("share-tree").onclick = () => shareLink($("share-tree"), `${tree.name} · ${tree.site_name}`, treeUrl);

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
      comparison?.to ? highlightComparison() : highlight(selected);
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
window.addEventListener("resize", () => {
  if (comparison?.to) centreOn(comparison.result.path.length ? comparison.result.path : [comparison.from]);
});
updateLayoutButtons();

// Person card

let selected = null;
let comparison = null;
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
      if (terms.length && !matches.length) results.append(el("p", { class: "none", role: "status" }, "No matching people"));
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
    body.append(label, input, el("p", { class: "compare-hint" }, "Or select someone in the tree."), results);
  } else {
    body.classList.add("comparison-result");
    body.replaceChildren();
    const summary = from === to ? "The same person" : result.term
      ? `${displayName(to)} is ${displayName(from)}’s ${result.term}.`
      : result.path.length ? "Connected through family" : "No recorded connection in this tree.";
    body.append(el("p", { class: "compare-summary", role: "status", tabindex: "-1" }, summary));
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
// Phones take large photos, so upload a 512px square crop from the middle.
async function square(file) {
  const image = await createImageBitmap(file);
  const side = Math.min(image.width, image.height);
  const size = Math.min(512, side);
  const canvas = el("canvas", { width: size, height: size });
  canvas.getContext("2d").drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, size, size);
  image.close();
  return new Promise((done, fail) => canvas.toBlob((blob) => (blob ? done(blob) : fail(new Error())), "image/jpeg", 0.85));
}
const errorOf = async (response) => (await response.json().catch(() => ({}))).error || "Something went wrong. Try again.";

// Tap the profile photo to add or replace it. Previous uploads are retained.
function photoEditor(id) {
  const circle = avatar(id, "lg");
  if (PLACEHOLDER.test(person(id).name)) return { circle, panel: null };
  const badge = el("span", { class: "badge", "aria-hidden": "true" });
  badge.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/></svg>';
  const button = el("button", { class: "photo", "aria-label": "Photo", "aria-expanded": "false" }, circle, badge);
  const panel = el("div", { class: "photo-panel", hidden: "" });
  const picker = el("input", { type: "file", accept: "image/*", hidden: "" });
  const show = (...kids) => {
    panel.replaceChildren(...kids.filter(Boolean), picker);
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    const card = panel.closest("#card");
    if (card && matchMedia("(max-width: 640px)").matches && !card.classList.contains("expanded")) card.querySelector(".sheet-toggle").click();
    panel.scrollIntoView({ block: "nearest" });
  };
  const hide = () => {
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };
  const note = (text, error = false) => text && el("p", { class: `status${error ? " error" : ""}` }, text);

  function menu(message = "", error = false) {
    const choose = el("button", { class: "action" }, photos[id] ? "Change photo" : "Add photo");
    choose.onclick = () => picker.click();
    const remove = photos[id] && window.familySite?.canEdit() ? el("button", { class: "text-button danger" }, "Remove photo") : null;
    if (remove) remove.onclick = async () => {
      if (!confirm("Remove this profile photo? Uploaded photos will be kept.")) return;
      choose.disabled = remove.disabled = button.disabled = true;
      remove.textContent = "Removing…";
      const response = await send("DELETE", id).catch(() => null);
      button.disabled = false;
      if (response?.ok) {
        delete photos[id]; repaint(id); return hide();
      }
      if (panel.isConnected) menu(response ? await errorOf(response) : "Couldn't connect. Try again.", true);
    };
    show(note(message, error), el("div", { class: "row" }, choose), remove);
  }
  picker.onchange = async () => {
    const chosen = picker.files[0];
    picker.value = "";
    if (!chosen) return;
    show(note("Preparing preview…"));
    let body, source;
    try {
      body = await square(chosen);
      source = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(body);
      });
    } catch {
      return menu("Couldn't read that image. Try a JPEG or PNG.", true);
    }
    if (!panel.isConnected) return;
    function preview(message = "") {
      const image = el("img", { class: "photo-preview", src: source, alt: "Preview of the profile photo" });
      const save = el("button", { class: "action" }, "Save photo");
      const another = el("button", { class: "action" }, "Choose another");
      another.onclick = () => picker.click();
      save.onclick = async () => {
        save.disabled = another.disabled = button.disabled = true;
        save.textContent = "Saving…";
        const response = await send("PUT", id, body).catch(() => null);
        button.disabled = false;
        if (response?.ok) {
          photos[id] = (await response.json()).v;
          repaint(id);
          return hide();
        }
        if (panel.isConnected) preview(response ? await errorOf(response) : "Couldn't connect. Try again.");
      };
      show(image, note(message, true), el("div", { class: "row" }, save, another));
    }
    preview();
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

function select(id, preserveComparison = false) {
  if (!preserveComparison && comparison && !comparison.to) {
    comparison.to = id;
    comparison.result = compareRelationship(tree, comparison.from, id);
    id = comparison.from;
    } else if (!preserveComparison && comparison?.to) resetComparison();
  clear();
  selected = id;
  const p = person(id);
  const partners = partnersOf(tree, id);
  const up = parentsOf(tree, id);
  const related = highlight(id);
  const link = el("button", { class: "action" }, "Share person");
  link.onclick = () => shareLink(link, `${displayName(id)} · ${tree.name}`, `${treeUrl}#${id}`);
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
    el("div", { class: "top" }, photo.circle, el("div", { class: "who" }, el("h2", {}, displayName(id)))),
    el("div", { class: "details-body", id: "details-body" },
      facts.length ? el("dl", { class: "person-facts" }, ...facts.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])) : null,
      window.familySite?.personActions(id),
      photo.panel,
      group("Parents", parentsOf(tree, id)),
      group(partners.length > 1 ? "Partners" : "Partner", partners, (o) => partnerNote(id, o)),
      group("Siblings", siblings(tree, id), (o) => (halfSiblings(tree, id, o) ? "Half" : "")),
      group("Children", children(tree, id)),
      p.other_trees?.length ? el("section", {}, el("h3", {}, "Other trees"),
        ...p.other_trees.map((other) => el("a", {
          class: "relative tree-link", href: apiUrl(`/trees/${other.id}#${id}`),
        }, other.name)),
      ) : null,
      related.size === 1 ? el("p", { class: "none" }, "No family recorded yet.") : null,
    ),
    el("div", { class: "actions" }, compare, link, window.familySite?.suggestionAction(id)),
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
  if (comparison) renderComparison(box);

  // While the tree glides to the person, the card waits at its final spot and appears on arrival.
  const frame = comparison ? (comparison.result?.path.length ? comparison.result.path : [id]) : [id, ...up, ...children(tree, id), ...partners];
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
  if (comparison?.to) {
    highlightComparison();
    centreOn(comparison.result.path.length ? comparison.result.path : [id]);
    box.querySelector(".compare-summary").focus({ preventScroll: true });
  }
  history.replaceState(null, "", `#${id}`);
}
function clear() {
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
fetch(apiUrl("/api/photos"))
    .then((response) => (response.ok ? response.json() : {}))
    .then((found) => {
      photos = found;
      Object.keys(found).forEach(repaint);
    })
    .catch(() => {});
})().catch((error) => {
  console.error("Unable to lay out family tree", error);
  document.getElementById("view").replaceChildren(Object.assign(document.createElement("p"), {
    className: "empty-tree", textContent: "The family tree could not be displayed. Please reload to try again.",
  }));
});
