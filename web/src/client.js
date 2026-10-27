(() => {
  const base = document.currentScript.dataset.base;
  const $ = id => document.getElementById(id);
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) key === "class" ? node.className = value : node.setAttribute(key, value);
    node.append(...children.filter(value => value !== null && value !== undefined && value !== false));
    return node;
  };
  const skeleton = (size = "") => el("span", { class: `skeleton ${size}`, "aria-hidden": "true" }, "\u00a0");
  const button = (label, onclick, className = "site-button") => {
    const node = el("button", { class: className, type: "button" }, label); node.onclick = onclick; return node;
  };
  const icon = paths => { const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("class", "icon"); svg.setAttribute("aria-hidden", "true"); for (const d of paths) { const p = document.createElementNS(svg.namespaceURI, "path"); p.setAttribute("d", d); svg.append(p); } return svg; };
  async function api(path, body, method = body === undefined ? "GET" : "POST") {
    let response;
    try {
      response = await fetch(`${base}/api${path}`, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new Error("Couldn't connect. Please try again.");
    }
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401 && path !== "/google/login") location.reload();
      throw new Error(result.error || "Couldn't complete this change. Please try again.");
    }
    return result;
  }
  let toastNotice, toastTimer;
  function toast(message, kind) {
    clearTimeout(toastTimer); toastNotice?.remove();
    const notice = el("div", { class: "site-toast", "data-kind": kind, role: kind === "error" ? "alert" : "status", popover: "manual" });
    notice.append(icon(kind === "error" ? ["M12 8v5m0 3h.01", "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18"] : ["m5 12 4 4L19 6"]), el("span", {}, message));
    (activeDialog || document.body).append(notice);
    notice.showPopover(); toastNotice = notice;
    toastTimer = setTimeout(() => notice.remove(), kind === "error" ? 8000 : 5000);
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
  async function googleSignIn(container) {
    container.signInObserver?.disconnect();
    container.replaceChildren(skeleton("skeleton-google"));
    container.setAttribute("aria-label", "Loading Google sign-in");
    container.setAttribute("aria-busy", "true");
    try {
      if (!session.googleClientId) throw new Error("Editor sign-in hasn't been configured yet.");
      const challenge = await api("/google/start", {});
      if (!window.google?.accounts) {
        await new Promise((resolve, reject) => {
          const script = el("script", { src: "https://accounts.google.com/gsi/client", async: "", defer: "" });
          script.onload = resolve; script.onerror = () => reject(new Error("Google sign-in couldn't load. Please try again.")); document.head.append(script);
        });
      }
      if (!container.isConnected) return;
      window.google.accounts.id.initialize({ client_id: session.googleClientId, nonce: challenge.nonce, auto_select: false,
        callback: async response => {
          try {
            await api("/google/login", { credential: response.credential });
            try { sessionStorage.setItem("family-editor-signed-in", "1"); location.reload(); }
            catch { activeDialog?.close(); toast("Signed in to edit.", "success"); setTimeout(() => location.reload(), 3000); }
          } catch (error) {
            if (!container.isConnected) return;
            toast(error.message, "error");
            await googleSignIn(container);
          }
        },
      });
      let width = 0;
      const render = () => {
        const next = Math.min(400, Math.floor(container.clientWidth));
        if (!next || next === width) return;
        width = next; container.replaceChildren();
        window.google.accounts.id.renderButton(container, { type: "standard", theme: document.documentElement.dataset.theme === "dark" ? "filled_black" : "outline", size: "large", shape: "rectangular", text: "signin_with", width });
      };
      render();
      if (!container.signInObserver) container.closest("dialog").addEventListener("close", () => container.signInObserver?.disconnect(), { once: true });
      container.signInObserver = new ResizeObserver(render); container.signInObserver.observe(container);
    } catch (error) {
      if (!container.isConnected) return;
      container.replaceChildren(); toast(error instanceof TypeError ? "Google sign-in couldn’t load. Please try again." : error.message, "error");
      if (session.googleClientId) container.append(button("Try again", () => googleSignIn(container)));
    } finally { container.setAttribute("aria-busy", "false"); container.removeAttribute("aria-label"); }
  }
  function editorSignIn() {
    const panel = dialog("Sign in to edit");
    if (!panel) return;
    panel.box.classList.add("editor-sign-in");
    panel.footer.remove();
    const holder = el("div", { class: "google-sign-in" });
    const note = el("p", { class: "form-note", id: "editor-sign-in-note" }, "Use an approved Google account.");
    panel.box.setAttribute("aria-describedby", note.id);
    panel.body.append(note, holder);
    googleSignIn(holder);
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
    panel.box.classList.add("suggestions-dialog");
    panel.footer.remove();
    const status = el("p", { class: "form-status", role: "status" });
    const list = el("div", { class: "suggestions-list" });
    const filters = el("div", { class: "suggestion-filters", role: "group", "aria-label": "Filter suggestions" });
    panel.box.querySelector(".dialog-top").after(filters);
    list.setAttribute("aria-busy", "true");
    list.setAttribute("aria-label", "Loading suggestions");
    list.append(el("article", { class: "inbox-item", "aria-hidden": "true" },
      el("div", { class: "inbox-heading" }, skeleton("skeleton-medium")),
      el("p", { class: "skeleton-paragraph" }, skeleton(), skeleton("skeleton-medium")),
      el("p", { class: "inbox-meta" }, skeleton("skeleton-medium"))));
    panel.body.append(status, list);
    let items = [], filter = "open";
    const choices = [["open", "New"], ["done", "Reviewed"], ["all", "All"]];
    const tabs = choices.map(([value, label]) => {
      const tab = button(label, () => { filter = value; render(); }, "site-button");
      tab.disabled = true; filters.append(tab); return tab;
    });
    const fail = error => { status.classList.add("is-error"); status.textContent = error.message; status.scrollIntoView({ block: "nearest" }); };
    function render() {
      choices.forEach(([value, label], index) => {
        tabs[index].textContent = `${label} (${items.filter(item => value === "all" || item.status === value).length})`;
        tabs[index].setAttribute("aria-pressed", String(filter === value));
      });
      const visible = items.filter(item => filter === "all" || item.status === filter);
      list.replaceChildren();
      if (!visible.length) list.append(el("p", { class: "suggestions-empty" }, items.length ? `No ${filter === "done" ? "reviewed" : "new"} suggestions.` : "No suggestions yet."));
      for (const item of visible) {
        const date = new Date(item.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
        const row = el("article", { class: "inbox-item" },
          el("div", { class: "inbox-heading" }, el("strong", {}, item.person_name || "General suggestion"), el("span", { class: "inbox-meta" }, `${item.status === "done" ? "Reviewed · " : ""}${date}`)),
          el("p", { class: "inbox-message" }, item.message),
          el("p", { class: "inbox-meta" }, `From ${item.sender_name}`),
          item.contact ? el("p", { class: "inbox-meta" }, item.contact) : null);
        const actions = el("div", { class: "inbox-actions" });
        if (item.person_id && (data?.tree?.people[item.person_id] || item.tree_id)) actions.append(button("Open person", () => {
          if (!data?.tree?.people[item.person_id]) { location.href = `${base}/t/${item.tree_short_id}#${item.person_short_id}`; return; }
          panel.box.close(); location.hash = data.tree.people[item.person_id].short_id;
          document.dispatchEvent(new CustomEvent("family-person-select", { detail: item.person_id }));
        }, "text-button"));
        const change = async (action, operation) => {
          if (panel.box.saving) return;
          panel.box.saving = true;
          status.textContent = ""; status.classList.remove("is-error");
          const controls = [...panel.box.querySelectorAll("button")];
          controls.forEach(control => control.disabled = true);
          action.textContent = "Saving…";
          try { await operation(); render(); }
          catch (error) { action.textContent = action === remove ? "Delete" : item.status === "done" ? "Reopen" : "Mark reviewed"; fail(error); }
          finally { panel.box.saving = false; controls.forEach(control => control.disabled = false); }
        };
        const review = button(item.status === "done" ? "Reopen" : "Mark reviewed", () => change(review, async () => {
          const next = item.status === "done" ? "open" : "done";
          await api(`/suggestions/${item.id}`, { status: next }, "PATCH"); item.status = next;
        }), "text-button");
        const remove = button("Delete", () => {
          if (confirm("Permanently delete this suggestion? This cannot be undone.")) change(remove, async () => {
            await api(`/suggestions/${item.id}`, undefined, "DELETE"); items = items.filter(other => other.id !== item.id);
          });
        }, "text-button danger");
        actions.append(review, remove); row.append(actions); list.append(row);
      }
    }
    try { items = await api("/suggestions"); status.textContent = ""; render(); }
    catch (error) { list.replaceChildren(); fail(error); }
    finally { list.removeAttribute("aria-label"); list.removeAttribute("aria-busy"); tabs.forEach(tab => tab.disabled = false); }
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
      // Keep the label visible when a person is selected.
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
    const loading = el("div", { class: "skeleton-form", "aria-busy": "true", "aria-label": "Loading people" },
      el("p", { class: "form-note" }, p.name),
      el("span", { class: "skeleton-label" }, `Relationship to ${p.name}`), skeleton("skeleton-field"),
      el("span", { class: "skeleton-label" }, "Person"), skeleton("skeleton-field"));
    panel.body.append(loading);
    let people, photos;
    try { [people, photos] = await Promise.all([api("/people"), api("/photos")]); }
    catch (error) { loading.className = "form-note is-error"; loading.removeAttribute("aria-busy"); loading.removeAttribute("aria-label"); loading.textContent = error.message; panel.footer.append(button("Close", () => panel.box.dismiss())); return; }
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
    panel.box.classList.add("editor-access");
    const list = el("div", { class: "editor-access-list", "aria-busy": "true", "aria-label": "Loading editors" }, el("div", { class: "connection-row" }, skeleton("skeleton-medium")));
    panel.body.append(el("p", { class: "form-note" }, `Owner: ${session.email}`), list);
    let input;
    const { form, status, finish } = formIn(panel, "Add editor", async () => { await api("/editors", { email: input.value }); input.value = ""; await refresh(); });
    input = field(form, "Google account email", "", { required: true, type: "email", max: 254 }); finish();
    async function refresh() {
      const items = await api("/editors"); list.replaceChildren(...items.map(item => el("div", { class: "connection-row" }, el("span", {}, item.email), button("Remove", async () => {
        try { if (!confirm(`Remove editor access for ${item.email}?`)) return; await api("/editors", { email: item.email }, "DELETE"); await refresh(); }
        catch (error) { status.classList.add("is-error"); status.textContent = error.message; }
      }, "text-button"))));
    }
    try { await refresh(); } catch (error) { list.replaceChildren(); status.classList.add("is-error"); status.textContent = error.message; }
    finally { list.removeAttribute("aria-busy"); list.removeAttribute("aria-label"); }
    if (panel.box.isConnected) input.focus();
  }
  function mountHeader() {
    const actions = document.querySelector("header > .actions");
    const signOut = async () => { await api("/logout", {}); location.reload(); };
    const menu = el("details", { class: "site-menu", name: "family-header-menu" }), summary = el("summary", { "aria-label": "Family menu", title: "Family menu" }, icon(["M5 12h.01M12 12h.01M19 12h.01"]));
    const items = el("div", { class: "menu-items" });
    const item = (label, paths, action) => {
      const entry = button("", () => { menu.open = false; action(); });
      entry.append(icon(paths), el("span", {}, label)); items.append(entry); return entry;
    };
    if (session.role !== "member") {
      const avatar = el("span", { class: "account-avatar", "aria-hidden": "true" },
        (session.name || session.email).trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join("").toUpperCase());
      if (session.picture) {
        const image = el("img", { src: session.picture, alt: "", referrerpolicy: "no-referrer", hidden: "" });
        image.onload = () => { image.hidden = false; }; avatar.append(image);
      }
      items.append(el("div", { class: "account-identity" }, avatar,
        el("div", { class: "account-address" }, session.name ? el("strong", { class: "account-name" }, session.name) : null, el("span", {}, session.email))));
    }
    const treeShortId = location.pathname.slice(base.length).match(/^\/t\/([1-9A-HJ-NP-Za-km-z]{12})\/?$/)?.[1];
    item("Send a suggestion", ["M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9H13a8.5 8.5 0 0 1 8 8v.5Z"], () => suggest());
    if (session.role !== "member") item("Family suggestions", ["M4 4h16v16H4zM4 13h4l2 3h4l2-3h4"], inbox);
    if (session.role === "owner") {
      item("Editor access", ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87", "M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"], manageAccess);
      if (session.backup?.error) {
        const notice = el("p", { class: "backup-notice", role: "status" }, session.backup.error);
        items.append(notice);
      }
    }
    if (treeShortId) items.append(el("a", { href: `${base}/api/t/${treeShortId}/gedcom`, download: "" }, icon(["M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5"]), el("span", {}, "Download GEDCOM")));
    items.append(el("hr", { class: "menu-divider" }));
    const themeLabel = () => document.documentElement.dataset.theme === "dark" ? "Use light mode" : "Use dark mode";
    const theme = item(themeLabel(), ["M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"], () => {
      const dark = document.documentElement.dataset.theme !== "dark";
      dark ? document.documentElement.dataset.theme = "dark" : delete document.documentElement.dataset.theme;
      theme.querySelector("span").textContent = themeLabel();
      try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch {}
    });
    theme.id = "theme";
    items.append(el("a", { href: "https://github.com/jaiamin/family-tree", target: "_blank", rel: "noopener" },
      icon(["M9 19c-4 1-4-2-6-2M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5a5.4 5.4 0 0 0-1-3.5c.3-1.2.3-2.4 0-3.5 0 0-1 0-3 1.5a15.4 15.4 0 0 0-8 0C6 2 5 2 5 2c-.3 1.1-.3 2.3 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5A4.8 4.8 0 0 0 9 18v4"]), el("span", {}, "GitHub")));
    items.append(el("hr", { class: "menu-divider" }));
    if (session.role === "member") item("Edit", ["M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L9 17l-4 1 1-4Z"], editorSignIn);
    item(session.role === "member" ? "Sign out" : "Sign out of editing", ["M9 5H5v14h4M14 8l4 4-4 4M9 12h9"], signOut);
    menu.append(summary, items); document.querySelector(".header-utilities").replaceChildren(menu);
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
    const match = location.pathname.slice(base.length).match(/^\/t\/([1-9A-HJ-NP-Za-km-z]{12})\/?$/);
    data = await (initialView || api(`/view${match ? `?tree=${match[1]}` : ""}`));
    initialView = null;
    $("title").textContent = data.siteName;
    document.title = data.tree ? `${data.tree.name} · ${data.siteName}` : data.siteName;
    if (data.tree) {
      const current = document.querySelector(".current-tree"); current.textContent = data.tree.name; current.href = `${base}/t/${data.tree.short_id}`;
      $("tree-options").replaceChildren(...data.trees.map(tree => {
        const current = tree.id === data.tree.id;
        return el("li", {}, el("a", {
          href: `${base}/t/${tree.short_id}`, "aria-label": `${tree.name}, ${tree.people} ${tree.people === 1 ? "person" : "people"}`,
          ...current ? { "aria-current": "page" } : {},
        }, el("span", { class: "tree-option-check", "aria-hidden": "true" }, current ? icon(["m5 12 4 4L19 6"]) : null),
          el("span", { class: "tree-option-name" }, tree.name),
          el("span", { class: "tree-option-count", "aria-hidden": "true" }, String(tree.people))));
      }));
    } else {
      $("family-heading").textContent = `Family trees (${data.trees.length})`;
      $("family-list").replaceChildren(...data.trees.map(tree => el("li", {}, el("a", { class: "tree-card", href: `${base}/t/${tree.short_id}` }, el("div", {}, el("h3", {}, tree.name), el("p", {}, `${tree.people} ${tree.people === 1 ? "person" : "people"}`)), icon(["m9 6 6 6-6 6"])))));
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
  const treeMatch = location.pathname.slice(base.length).match(/^\/t\/([1-9A-HJ-NP-Za-km-z]{12})\/?$/);
  const sessionRequest = api("/session");
  let initialView = document.body.dataset.login ? null : api(`/view${treeMatch ? `?tree=${treeMatch[1]}` : ""}`);
  // Requests start while the deferred graph engine is parsing; the UI handles failures below.
  sessionRequest.catch(() => {});
  initialView?.then(view => {
    const person = Object.values(view.tree?.people || {}).find(person => person.short_id === location.hash.slice(1));
    const id = person?.id, version = view.tree?.photo_versions[id];
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
        try {
          const signedIn = sessionStorage.getItem("family-editor-signed-in");
          sessionStorage.removeItem("family-editor-signed-in");
          if (signedIn && session.role !== "member") toast("Signed in to edit.", "success");
        } catch {}
        if ($("family-list")) await loadTree();
      }
      resolve();
    } catch (error) { document.body.replaceChildren(el("main", { class: "login-main" }, el("p", { role: "status" }, error.message), button("Try again", () => location.reload()))); resolve(); }
  }, { once: true }));
})();
