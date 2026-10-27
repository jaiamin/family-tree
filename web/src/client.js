(() => {
  const base = document.currentScript.dataset.base;
  const $ = id => document.getElementById(id);
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) key === "class" ? node.className = value : node.setAttribute(key, value);
    node.append(...children.filter(value => value !== null && value !== undefined && value !== false));
    return node;
  };
  const button = (label, onclick, className = "site-button") => {
    const node = el("button", { class: className, type: "button" }, label); node.onclick = onclick; return node;
  };
  const icon = paths => { const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("class", "icon"); svg.setAttribute("aria-hidden", "true"); for (const d of paths) { const p = document.createElementNS(svg.namespaceURI, "path"); p.setAttribute("d", d); svg.append(p); } return svg; };
  async function api(path, body, method = body === undefined ? "GET" : "POST") {
    const response = await fetch(`${base}/api${path}`, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401 && path !== "/google/login") location.reload();
      throw new Error(result.error || "Couldn't complete this change. Please try again.");
    }
    return result;
  }
  let session, data;
  let activeDialog;
  function dialog(title) {
    if (activeDialog && !activeDialog.dismiss()) return null;
    const box = el("dialog", { class: "site-dialog", "aria-label": title });
    const shut = button("", () => box.dismiss(), "dialog-close"); shut.setAttribute("aria-label", "Close"); shut.append(icon(["M18 6 6 18M6 6l12 12"]));
    const body = el("div", { class: "dialog-body" }), footer = el("div", { class: "dialog-footer" });
    box.append(el("div", { class: "dialog-top" }, el("h2", {}, title), shut), body, footer);
    box.dirty = false;
    box.dismiss = () => {
      if (box.saving || box.dirty && !confirm("Discard your unsaved changes?")) return false;
      box.close(); return true;
    };
    box.addEventListener("cancel", event => { event.preventDefault(); box.dismiss(); });
    box.addEventListener("keydown", event => { if (event.key === "Escape") event.stopPropagation(); });
    const before = document.activeElement;
    box.onclose = () => { box.remove(); if (activeDialog === box) activeDialog = null; before?.focus({ preventScroll: true }); };
    box.addEventListener("click", event => { if (event.target === box) { const r = box.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) box.dismiss(); } });
    document.body.append(box); activeDialog = box; box.showModal();
    return { box, body, footer };
  }
  addEventListener("beforeunload", event => {
    if (activeDialog?.dirty) { event.preventDefault(); event.returnValue = ""; }
  });
  const reload = () => { if (activeDialog) activeDialog.dirty = false; document.dispatchEvent(new Event("family-tree-before-reload")); location.reload(); };
  function field(parent, label, value = "", options = {}) {
    const id = `field-${crypto.randomUUID()}`;
    const input = options.choices ? el("select", { id, name: options.name || label }, ...options.choices.map(([value, label]) => el("option", { value }, label)))
      : el(options.multiline ? "textarea" : "input", { id, name: options.name || label, ...options.multiline ? {} : { type: options.type || "text" }, maxlength: String(options.max || 300) });
    input.value = value || ""; if (options.required) input.required = true;
    parent.append(el("label", { for: id }, label), input);
    return input;
  }
  function formIn(panel, submitLabel, onsubmit, { cancel = true } = {}) {
    const form = el("form", { id: `form-${crypto.randomUUID()}` });
    const status = el("p", { class: "form-status", role: "status" });
    panel.body.append(form);
    const save = el("button", { class: "site-button primary", type: "submit", form: form.id }, submitLabel);
    if (cancel) panel.footer.append(button("Cancel", () => panel.box.dismiss()));
    panel.footer.append(save);
    const snapshot = () => JSON.stringify([...new FormData(form)]);
    let initial;
    queueMicrotask(() => { initial = snapshot(); });
    const changed = () => { panel.box.dirty = snapshot() !== initial; };
    form.addEventListener("input", changed);
    form.addEventListener("change", changed);
    form.onsubmit = async event => {
      event.preventDefault(); if (!form.reportValidity()) return;
      save.disabled = true; save.textContent = submitLabel.startsWith("Send") ? "Sending…" : "Saving…"; panel.box.saving = true; status.classList.remove("is-error"); status.textContent = "";
      try { await onsubmit(); panel.box.dirty = false; initial = snapshot(); }
      catch (error) { status.classList.add("is-error"); status.textContent = error.message; status.scrollIntoView({ block: "nearest" }); }
      finally { save.disabled = false; save.textContent = submitLabel; panel.box.saving = false; }
    };
    return { form, status, finish: () => form.append(status) };
  }
  async function googleSignIn(container, status) {
    try {
      if (!session.googleClientId) throw new Error("Editor sign-in hasn't been configured yet.");
      const challenge = await api("/google/start", {});
      if (!window.google?.accounts) {
        await new Promise((resolve, reject) => {
          const script = el("script", { src: "https://accounts.google.com/gsi/client", async: "", defer: "" });
          script.onload = resolve; script.onerror = () => reject(new Error("Google sign-in couldn't load. Please try again.")); document.head.append(script);
        });
      }
      window.google.accounts.id.initialize({ client_id: session.googleClientId, nonce: challenge.nonce, auto_select: false,
        callback: async response => { try { await api("/google/login", { credential: response.credential }); location.reload(); } catch (error) { status.classList.add("is-error"); status.textContent = error.message; } },
      });
      status.textContent = "";
      container.replaceChildren();
      window.google.accounts.id.renderButton(container, { type: "standard", theme: "outline", size: "large", text: "signin_with", width: 232 });
    } catch (error) { container.replaceChildren(); status.classList.add("is-error"); status.textContent = error.message; }
  }
  function editorSignIn() {
    const panel = dialog("Editor sign-in");
    if (!panel) return;
    panel.box.classList.add("editor-sign-in");
    panel.footer.remove();
    const holder = el("div", { class: "google-sign-in" }, "Loading sign-in…"), status = el("p", { class: "form-status", role: "status" });
    panel.body.append(el("p", { class: "form-note" }, "Use your approved Google account."), holder, status);
    googleSignIn(holder, status);
  }
  function suggest(personId) {
    const panel = dialog(personId ? "Suggest a change" : "Send a suggestion");
    if (!panel) return;
    const p = personId && data?.tree?.people[personId];
    panel.body.append(el("p", { class: "form-note" }, p ? `About ${p.name}` : "Shared privately with family editors."));
    let name, contact, message;
    const { form, finish } = formIn(panel, "Send suggestion", async () => {
      await api("/suggestions", { personId: personId || null, name: name.value, contact: contact.value, message: message.value });
      try { localStorage.setItem("family-suggestion-name", name.value); } catch {}
      panel.body.replaceChildren(el("p", { class: "form-note", role: "status" }, "Thank you. Sent to the family editors."));
      panel.footer.replaceChildren(button("Done", () => panel.box.dismiss()));
    }, { cancel: false });
    let saved = ""; try { saved = localStorage.getItem("family-suggestion-name") || ""; } catch {}
    name = field(form, "Your name", saved, { required: true, max: 100 });
    contact = field(form, "Email or phone (optional)", "", { max: 200 });
    message = field(form, "Suggestion", "", { required: true, multiline: true, max: 3000 });
    finish(); name.focus();
  }
  async function inbox() {
    const panel = dialog("Family suggestions");
    if (!panel) return;
    const status = el("p", { class: "form-status", role: "status" }, "Loading…"); panel.body.append(status);
    panel.footer.append(button("Done", () => panel.box.dismiss()));
    try {
      const items = await api("/suggestions"); status.remove();
      if (!items.length) panel.body.append(el("p", { class: "form-note" }, "No suggestions yet."));
      for (const item of items) {
        const row = el("div", { class: "inbox-item" }, el("strong", {}, item.person_name || "General suggestion"), el("p", {}, item.message),
          el("p", { class: "inbox-meta" }, `From ${item.sender_name}${item.contact ? ` · ${item.contact}` : ""}`), el("p", { class: "inbox-meta" }, new Date(item.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })));
        const toggle = button(item.status === "done" ? "Reopen" : "Mark as reviewed", async () => {
          try { await api(`/suggestions/${item.id}`, { status: item.status === "done" ? "open" : "done" }, "PATCH"); item.status = item.status === "done" ? "open" : "done"; toggle.textContent = item.status === "done" ? "Reopen" : "Mark as reviewed"; }
          catch (error) { status.classList.add("is-error"); status.textContent = error.message; panel.body.prepend(status); }
        }, "text-button");
        if (item.person_id && data?.tree?.people[item.person_id]) row.append(button("Open person", () => {
          panel.box.close(); location.hash = item.person_id;
          document.dispatchEvent(new CustomEvent("family-person-select", { detail: item.person_id }));
        }, "text-button"));
        row.append(toggle); panel.body.append(row);
      }
    } catch (error) { status.classList.add("is-error"); status.textContent = error.message; }
  }
  const detailFields = (form, p) => {
    const fields = {};
    fields.name = field(form, "Name", p.name, { required: true, max: 200 });
    fields.sex = field(form, "Gender", p.sex, { choices: [["", "Not specified"], ["male", "Male"], ["female", "Female"]] });
    const dates = el("div", { class: "form-grid" });
    for (const [key, label] of [["birth_date", "Birth date"], ["death_date", "Death date"]]) {
      const cell = el("div"); fields[key] = field(cell, label, p[key]); dates.append(cell);
    }
    form.append(dates, el("p", { class: "field-hint" }, "Dates are optional. Use YYYY-MM-DD, a year, or approximate text."));
    fields.birth_place = field(form, "Birth place", p.birth_place);
    fields.notes = field(form, "Notes", p.notes, { multiline: true, max: 5000 });
    return fields;
  };
  const valuesOf = fields => Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value]));
  function editPerson(id) {
    const p = data.tree.people[id], panel = dialog("Edit details");
    if (!panel) return;
    panel.box.classList.add("edit-person");
    panel.body.append(el("p", { class: "form-note edit-person-name" }, p.name));
    if (p.other_trees?.length) panel.body.append(el("p", { class: "form-note" }, `Changes also apply in ${p.other_trees.map(tree => tree.name).join(", ")}.`));
    let fields;
    const { form, finish } = formIn(panel, "Save changes", async () => {
      await api(`/people/${id}`, { revision: data.revision, fields: valuesOf(fields) }, "PATCH"); reload();
    });
    fields = detailFields(form, p);
    const links = [...p.parents.map(other => [other, "Parent", "parent"]), ...p.partners.map(other => [other, "Partner", "partner"]), ...Object.values(data.tree.people).filter(other => other.parents.includes(id)).map(other => [other.id, "Child", "child"])];
    const connections = el("details", { class: "edit-connections" }, el("summary", {}, `Connections (${links.length})`));
    for (const [other, label, relation] of links) {
      const remove = button("Disconnect", async () => {
        if (panel.box.dirty && !confirm("Discard your unsaved detail changes before disconnecting this person?")) return;
        if (!confirm(`Remove ${data.tree.people[other].name} as ${p.name}’s ${label.toLowerCase()}? Both people will stay in the tree.`)) return;
        remove.disabled = true; panel.box.saving = true;
        try { await api("/relationships", { revision: data.revision, personId: id, relativeId: other, relation, remove: true }); panel.box.dirty = false; reload(); }
        catch (error) { remove.disabled = false; const status = form.querySelector(".form-status"); status.classList.add("is-error"); status.textContent = error.message; }
        finally { panel.box.saving = false; }
      }, "text-button danger");
      connections.append(el("div", { class: "connection-row" }, el("div", {}, el("span", { class: "connection-name" }, data.tree.people[other].name), el("span", { class: "connection-label" }, label)), remove));
    }
    connections.append(button("Add relative", () => addRelative(id)));
    form.append(connections);
    if (session.role === "owner") form.append(el("div", { class: "delete-person-section" }, button("Permanently delete person", () => deletePerson(id), "text-button danger")));
    finish(); fields.name.focus();
  }
  function deletePerson(id) {
    const person = data.tree.people[id], panel = dialog("Delete person");
    if (!panel) return;
    panel.body.append(el("p", { class: "form-note" }, `Permanently delete ${person.name} from every tree and remove their relationships? This cannot be undone. Uploaded photo files will be retained.`));
    let confirmation;
    const { form, finish } = formIn(panel, "Permanently delete", async () => {
      if (confirmation.value !== person.name) throw new Error("Enter the person's full name exactly.");
      await api(`/people/${id}`, { revision: data.revision, name: confirmation.value }, "DELETE");
      panel.box.dirty = false; location.replace(location.pathname);
    });
    panel.footer.querySelector('button[type="submit"]').classList.add("danger");
    confirmation = field(form, "Type their full name to confirm", "", { required: true, max: 200 });
    confirmation.autocomplete = "off";
    finish(); confirmation.focus();
  }
  function personPicker(label, people, photos, { exclude, suggested = [], allowNew = false, onchange }) {
    const node = el("div", { class: "person-picker" });
    const search = field(node, label, "", { type: "search" });
    search.placeholder = "Search existing people"; search.autocomplete = "off"; search.removeAttribute("name");
    const results = el("div", { class: "person-picker-results" });
    const choice = el("div", { class: "person-selection", hidden: "" });
    const value = el("input", { type: "hidden", name: label, hidden: "" });
    const select = (id, name) => {
      value.value = id; search.hidden = Boolean(id); results.hidden = Boolean(id);
      node.querySelector("label").hidden = Boolean(id);
      if (create) create.hidden = Boolean(id);
      choice.hidden = !id;
      choice.replaceChildren(el("span", {}, name), button("Change", () => { select("", ""); search.focus(); }, "text-button"));
      onchange(); value.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const render = () => {
      const terms = search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
      const matches = people.filter(p => !exclude().includes(p.id) && (terms.length
        ? terms.every(term => p.name.toLowerCase().includes(term)) : suggested.includes(p.id))).slice(0, 20);
      results.replaceChildren(...matches.map(p => {
        const avatar = el("span", { class: "picker-avatar", "aria-hidden": "true" }, p.name.split(/\s+/).slice(0, 2).map(word => word[0]).join(""));
        if (photos[p.id]) avatar.replaceChildren(el("img", { src: `${base}/api/photos/${p.id}?v=${photos[p.id]}`, alt: "" }));
        const context = [p.birth_date, p.parents?.length ? `Parents: ${p.parents.join(" & ")}` : "", p.trees?.join(" · ")].filter(Boolean).join(" · ");
        const row = button("", () => select(p.id, p.name), "person-picker-option");
        row.append(avatar, el("span", { class: "picker-person" }, el("strong", {}, p.name), context ? el("span", {}, context) : null));
        return row;
      }));
      if (terms.length && !matches.length) results.append(el("p", { class: "form-note", role: "status" }, "No matching people."));
    };
    search.oninput = render;
    const create = allowNew ? button("Add a new person", () => select("new", "New person"), "text-button") : null;
    node.append(...[results, create, choice, value].filter(Boolean)); render();
    return { node, value, render, clear: () => select("", "") };
  }
  async function addRelative(id) {
    const p = data.tree.people[id], panel = dialog("Add a relative");
    if (!panel) return;
    panel.box.classList.add("add-relative");
    const loading = el("p", { class: "form-note", role: "status" }, "Loading people…"); panel.body.append(loading);
    let people, photos;
    try { [people, photos] = await Promise.all([api("/people"), api("/photos")]); }
    catch (error) { loading.textContent = error.message; panel.footer.append(button("Close", () => panel.box.dismiss())); return; }
    if (!panel.box.isConnected) return;
    loading.remove();
    let relation, partnership, fields;
    const { form, finish } = formIn(panel, "Add relative", async () => {
      if (!target.value.value) throw new Error("Choose an existing person or add a new person.");
      const common = { revision: data.revision, treeId: data.tree.id, relation: relation.value,
        status: relation.value === "partner" ? partnership.value : undefined,
        otherParentId: relation.value === "child" ? otherParent.value.value || null : undefined };
      if (target.value.value !== "new") await api("/relationships", { ...common, personId: id, relativeId: target.value.value });
      else await api("/people", { ...common, relativeId: id, fields: valuesOf(fields) });
      reload();
    });
    panel.body.prepend(el("p", { class: "form-note" }, p.name));
    relation = field(form, `Relationship to ${p.name}`, "", { required: true, choices: [["", "Choose relationship"], ["child", "Child"], ["parent", "Parent"], ["partner", "Partner"]] });
    partnership = field(form, "Partnership", "married", { choices: [["married", "Married"], ["partners", "Partners"]] });
    const partnershipLabel = form.querySelector(`label[for="${partnership.id}"]`);
    const summary = el("p", { class: "relative-summary", role: "status", hidden: "" });
    const updateSummary = () => {
      const name = target.value.value === "new" ? fields.name.value.trim() : people.find(person => person.id === target.value.value)?.name;
      const other = relation.value === "child" && people.find(person => person.id === otherParent.value.value);
      summary.hidden = !name || !relation.value;
      summary.textContent = name && relation.value ? `${name} will be added as ${p.name}${other ? ` and ${other.name}` : ""}’s ${relation.value}.` : "";
    };
    const target = personPicker("Person", people, photos, { exclude: () => [id], allowNew: true, onchange: () => {
      if (otherParent.value.value === target.value.value) otherParent.clear();
      updateDetails(); otherParent.render();
      if (target.value.value === "new") fields.name.focus();
    } });
    form.append(target.node);
    const details = el("div", { class: "new-person-details" }); fields = detailFields(details, {});
    const more = el("details", { class: "relative-more" }, el("summary", {}, "More details"));
    more.append(...[...details.children].slice(4)); details.append(more); form.append(details);
    const otherParent = personPicker("Other parent (optional)", people, photos, {
      exclude: () => [id, target.value.value], suggested: p.partners, onchange: updateSummary,
    });
    otherParent.node.append(el("p", { class: "field-hint" }, "Choose only if known. Leave blank to keep the recorded parents unchanged."));
    form.append(otherParent.node);
    relation.onchange = () => {
      partnership.hidden = partnershipLabel.hidden = relation.value !== "partner";
      otherParent.node.hidden = relation.value !== "child";
      updateSummary();
    };
    partnership.hidden = partnershipLabel.hidden = otherParent.node.hidden = true;
    fields.name.oninput = updateSummary;
    function updateDetails() {
      details.hidden = target.value.value !== "new";
      for (const input of Object.values(fields)) input.disabled = target.value.value !== "new";
      updateSummary();
    }
    updateDetails(); form.append(summary); finish(); relation.focus();
  }
  async function manageAccess() {
    const panel = dialog("Editor access");
    if (!panel) return;
    const list = el("div");
    panel.body.append(el("p", { class: "form-note" }, `Owner: ${session.email}. Editors sign in with their own Google account.`), list);
    let input;
    const { form, status, finish } = formIn(panel, "Add editor", async () => { await api("/editors", { email: input.value }); input.value = ""; await refresh(); });
    input = field(form, "Google account email", "", { required: true, type: "email", max: 254 }); finish();
    async function refresh() {
      const items = await api("/editors"); list.replaceChildren(...items.map(item => el("div", { class: "connection-row" }, el("span", {}, item.email), button("Remove", async () => {
        try { if (!confirm(`Remove editor access for ${item.email}?`)) return; await api("/editors", { email: item.email }, "DELETE"); await refresh(); }
        catch (error) { status.classList.add("is-error"); status.textContent = error.message; }
      }, "text-button"))));
    }
    try { await refresh(); } catch (error) { status.classList.add("is-error"); status.textContent = error.message; }
  }
  function mountHeader() {
    const actions = document.querySelector("header > .actions");
    const signOut = async () => { await api("/logout", {}); location.reload(); };
    if (session.role === "member") actions.prepend(button("Edit", editorSignIn, "site-button edit-button"));
    else {
      const account = el("details", { class: "site-menu account-menu", name: "family-header-menu" });
      const accountAvatar = () => {
        const avatar = el("span", { class: "account-avatar", "aria-hidden": "true" },
          (session.name || session.email).trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join("").toUpperCase());
        if (session.picture) {
          const image = el("img", { src: session.picture, alt: "", referrerpolicy: "no-referrer", hidden: "" });
          image.onload = () => { image.hidden = false; };
          avatar.append(image);
        }
        return avatar;
      };
      const trigger = el("summary", { class: "account-trigger", title: session.email, "aria-label": `Account: ${session.email}` },
        accountAvatar(), icon(["m6 9 6 6 6-6"]));
      const signOutButton = button("", signOut);
      signOutButton.append(icon(["M9 5H5v14h4M14 8l4 4-4 4M9 12h9"]), el("span", {}, "Sign out of editing"));
      const options = el("div", { class: "menu-items" }, el("div", { class: "account-identity" }, accountAvatar(),
        el("div", { class: "account-address" }, session.name ? el("strong", { class: "account-name" }, session.name) : null, el("span", {}, session.email))), signOutButton);
      account.append(trigger, options); actions.prepend(account);
    }
    const menu = el("details", { class: "site-menu", name: "family-header-menu" }), summary = el("summary", { "aria-label": "Family menu", title: "Family menu" }, icon(["M5 12h.01M12 12h.01M19 12h.01"]));
    const items = el("div", { class: "menu-items" });
    const item = (label, paths, action) => {
      const entry = button("", () => { menu.open = false; action(); });
      entry.append(icon(paths), el("span", {}, label)); items.append(entry); return entry;
    };
    const treeId = location.pathname.slice(base.length).match(/^\/trees\/([0-9a-f-]+)\/?$/)?.[1];
    if (treeId) item("Share tree", ["M12 16V3m-4 4 4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"], () => $("share-tree").click()).classList.add("mobile-menu-item");
    if (treeId) items.append(el("a", { href: `${base}/api/trees/${treeId}/gedcom`, download: "" }, icon(["M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5"]), el("span", {}, "Download GEDCOM")));
    item("Send a suggestion", ["M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9H13a8.5 8.5 0 0 1 8 8v.5Z"], () => suggest());
    if (session.role !== "member") item("Family suggestions", ["M4 4h16v16H4zM4 13h4l2 3h4l2-3h4"], inbox);
    if (session.role === "owner") {
      item("Editor access", ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87", "M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"], manageAccess);
      if (session.backup?.error) {
        const notice = el("p", { class: "backup-notice", role: "status" }, session.backup.error);
        items.append(notice);
      }
    }
    if (session.role === "member") item("Sign out", ["M9 5H5v14h4M14 8l4 4-4 4M9 12h9"], signOut);
    menu.append(summary, items); document.querySelector(".header-utilities").append(menu);
    const headerMenus = [...actions.parentElement.querySelectorAll("details")];
    for (const dropdown of headerMenus) dropdown.addEventListener("toggle", () => {
      if (!dropdown.open) return;
      const panel = dropdown.querySelector(".menu-items"), anchor = dropdown.querySelector("summary").getBoundingClientRect();
      panel.style.left = `${Math.max(16, Math.min(anchor.right - panel.offsetWidth, innerWidth - panel.offsetWidth - 16))}px`;
      panel.style.top = `${anchor.bottom + 8}px`;
      panel.style.maxHeight = `${Math.max(80, innerHeight - anchor.bottom - 24)}px`;
    });
    addEventListener("resize", () => headerMenus.forEach(dropdown => dropdown.open = false));
    document.addEventListener("click", event => { for (const item of actions.parentElement.querySelectorAll("details")) if (!item.contains(event.target)) item.open = false; });
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      const open = [...actions.parentElement.querySelectorAll("details[open]")];
      if (!open.length) return;
      event.preventDefault(); event.stopPropagation();
      open.forEach(item => item.open = false); open[0].querySelector("summary").focus();
    });
  }
  async function loadTree() {
    const match = location.pathname.slice(base.length).match(/^\/trees\/([0-9a-f-]+)\/?$/);
    data = await (initialView || api(`/view${match ? `?tree=${match[1]}` : ""}`));
    initialView = null;
    $("title").textContent = data.siteName;
    document.title = data.tree ? `${data.tree.name} · ${data.siteName}` : data.siteName;
    if (data.tree) {
      const current = document.querySelector(".current-tree"); current.textContent = data.tree.name; current.href = `${base}/trees/${data.tree.id}`;
      $("tree-options").replaceChildren(...data.trees.map(tree => el("li", {}, el("a", { href: `${base}/trees/${tree.id}`, ...tree.id === data.tree.id ? { "aria-current": "page" } : {} }, tree.name))));
    } else {
      $("family-heading").textContent = `Family trees (${data.trees.length})`;
      $("family-list").replaceChildren(...data.trees.map(tree => el("li", {}, el("a", { class: "tree-card", href: `${base}/trees/${tree.id}` }, el("div", {}, el("h3", {}, tree.name), el("p", {}, `${tree.people} ${tree.people === 1 ? "person" : "people"}`)), icon(["m9 6 6 6-6 6"])))));
    }
    return data.tree;
  }
  window.familySite = { base, openDialog: dialog, loadTree: async () => { await ready; return loadTree(); }, editPerson,
    canEdit: () => session?.role === "editor" || session?.role === "owner",
    suggestionAction: id => {
      const action = button("Suggest", () => suggest(id), "action suggest-action");
      action.setAttribute("aria-label", "Suggest a change");
      return action;
    },
    personActions: id => {
      if (session.role === "member") return null;
      const tools = el("div", { class: "person-tools" });
      tools.append(button("Edit details", () => editPerson(id)), button("Add relative", () => addRelative(id)));
      return tools;
    },
  };
  const treeMatch = location.pathname.slice(base.length).match(/^\/trees\/([0-9a-f-]+)\/?$/);
  const sessionRequest = api("/session");
  let initialView = document.body.dataset.login ? null : api(`/view${treeMatch ? `?tree=${treeMatch[1]}` : ""}`);
  // Requests start while the deferred graph engine is parsing; the UI handles failures below.
  sessionRequest.catch(() => {});
  initialView?.then(view => {
    const id = decodeURIComponent(location.hash.slice(1)), version = view.tree?.photo_versions[id];
    if (version) document.head.append(el("link", { rel: "preload", as: "image", href: `${base}/api/photos/${id}?v=${version}` }));
  }).catch(() => {});
  const ready = new Promise(resolve => document.addEventListener("DOMContentLoaded", async () => {
    try {
      session = await sessionRequest;
      if (document.body.dataset.login) {
        $("login-title").textContent = session.siteName; document.title = session.siteName;
        const form = $("family-login"), status = $("login-status");
        form.onsubmit = async event => {
          event.preventDefault(); const submit = form.querySelector('button[type="submit"]'); submit.disabled = true; status.classList.remove("is-error"); status.textContent = ""; submit.textContent = "Opening…";
          try { await api("/login", { password: $("family-password").value }); location.reload(); } catch (error) { status.classList.add("is-error"); status.textContent = error.message; } finally { submit.disabled = false; submit.textContent = "Continue"; }
        };
        const password = $("family-password"), toggle = $("password-toggle");
        toggle.onclick = () => {
          const show = password.type === "password";
          password.type = show ? "text" : "password";
          toggle.textContent = show ? "Hide" : "Show";
          toggle.setAttribute("aria-pressed", String(show));
          toggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
        };
      } else {
        mountHeader();
        if ($("family-list")) await loadTree();
      }
      resolve();
    } catch (error) { document.body.replaceChildren(el("main", { class: "login-main" }, el("p", { role: "status" }, error.message), button("Try again", () => location.reload()))); resolve(); }
  }, { once: true }));
})();
