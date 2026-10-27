(() => {
  const base = document.currentScript.src.replace(location.origin, "").replace(/\/app\.js$/, "");
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
    activeDialog?.close();
    const box = el("dialog", { class: "site-dialog", "aria-label": title });
    const shut = button("", () => box.close(), "dialog-close"); shut.setAttribute("aria-label", "Close"); shut.append(icon(["M18 6 6 18M6 6l12 12"]));
    const body = el("div", { class: "dialog-body" }), footer = el("div", { class: "dialog-footer" });
    box.append(el("div", { class: "dialog-top" }, el("h2", {}, title), shut), body, footer);
    const before = document.activeElement;
    box.onclose = () => { box.remove(); if (activeDialog === box) activeDialog = null; before?.focus({ preventScroll: true }); };
    box.addEventListener("click", event => { if (event.target === box) { const r = box.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) box.close(); } });
    document.body.append(box); activeDialog = box; box.showModal();
    return { box, body, footer };
  }
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
    if (cancel) panel.footer.append(button("Cancel", () => panel.box.close()));
    panel.footer.append(save);
    form.onsubmit = async event => {
      event.preventDefault(); if (!form.reportValidity()) return;
      save.disabled = true; status.classList.remove("is-error"); status.textContent = "";
      try { await onsubmit(); }
      catch (error) { status.classList.add("is-error"); status.textContent = error.message; status.scrollIntoView({ block: "nearest" }); }
      finally { save.disabled = false; }
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
    panel.box.classList.add("editor-sign-in");
    panel.footer.remove();
    const holder = el("div", { class: "google-sign-in" }, "Loading sign-in…"), status = el("p", { class: "form-status", role: "status" });
    panel.body.append(el("p", { class: "form-note" }, "Use your approved Google account."), holder, status);
    googleSignIn(holder, status);
  }
  function suggest(personId) {
    const panel = dialog(personId ? "Suggest a change" : "Send a suggestion");
    const p = personId && data?.tree?.people[personId];
    panel.body.append(el("p", { class: "form-note" }, p ? `About ${p.name}` : "Shared privately with family editors."));
    let name, contact, message;
    const { form, finish } = formIn(panel, "Send suggestion", async () => {
      await api("/suggestions", { personId: personId || null, name: name.value, contact: contact.value, message: message.value });
      try { localStorage.setItem("family-suggestion-name", name.value); } catch {}
      panel.body.replaceChildren(el("p", { class: "form-note", role: "status" }, "Thank you. Sent to the family editors."));
      panel.footer.replaceChildren(button("Done", () => panel.box.close()));
    }, { cancel: false });
    let saved = ""; try { saved = localStorage.getItem("family-suggestion-name") || ""; } catch {}
    name = field(form, "Your name", saved, { required: true, max: 100 });
    contact = field(form, "Email or phone (optional)", "", { max: 200 });
    message = field(form, "Suggestion", "", { required: true, multiline: true, max: 3000 });
    finish(); name.focus();
  }
  async function inbox() {
    const panel = dialog("Family suggestions"), status = el("p", { class: "form-status", role: "status" }, "Loading…"); panel.body.append(status);
    panel.footer.append(button("Done", () => panel.box.close()));
    try {
      const items = await api("/suggestions"); status.remove();
      if (!items.length) panel.body.append(el("p", { class: "form-note" }, "No suggestions yet."));
      for (const item of items) {
        const row = el("div", { class: "inbox-item" }, el("strong", {}, item.person_name || "General suggestion"), el("p", {}, item.message),
          el("p", { class: "inbox-meta" }, `From ${item.sender_name}${item.contact ? ` · ${item.contact}` : ""}`), el("p", { class: "inbox-meta" }, item.created_at));
        const toggle = button(item.status === "done" ? "Reopen" : "Mark as reviewed", async () => {
          try { await api(`/suggestions/${item.id}`, { status: item.status === "done" ? "open" : "done" }, "PATCH"); item.status = item.status === "done" ? "open" : "done"; toggle.textContent = item.status === "done" ? "Reopen" : "Mark as reviewed"; }
          catch (error) { status.classList.add("is-error"); status.textContent = error.message; panel.body.prepend(status); }
        }, "text-button");
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
    form.append(dates);
    fields.birth_place = field(form, "Birth place", p.birth_place);
    fields.notes = field(form, "Notes", p.notes, { multiline: true, max: 5000 });
    return fields;
  };
  const valuesOf = fields => Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value]));
  function editPerson(id) {
    const p = data.tree.people[id], panel = dialog("Edit details");
    panel.box.classList.add("edit-person");
    panel.body.append(el("p", { class: "form-note edit-person-name" }, p.name));
    let fields;
    const { form, finish } = formIn(panel, "Save changes", async () => {
      await api(`/people/${id}`, { revision: data.revision, fields: valuesOf(fields) }, "PATCH"); location.reload();
    });
    fields = detailFields(form, p);
    const links = [...p.parents.map(other => [other, "Parent", "parent"]), ...p.partners.map(other => [other, "Partner", "partner"]), ...Object.values(data.tree.people).filter(other => other.parents.includes(id)).map(other => [other.id, "Child", "child"])];
    const connections = el("details", { class: "edit-connections" }, el("summary", {}, `Connections (${links.length})`));
    for (const [other, label, relation] of links) {
      const remove = button("Disconnect", async () => {
        if (!confirm(`Remove ${data.tree.people[other].name} as ${p.name}’s ${label.toLowerCase()}? Both people will stay in the tree.`)) return;
        remove.disabled = true;
        try { await api("/relationships", { revision: data.revision, personId: id, relativeId: other, relation, remove: true }); location.reload(); }
        catch (error) { remove.disabled = false; const status = form.querySelector(".form-status"); status.classList.add("is-error"); status.textContent = error.message; }
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
    panel.body.append(el("p", { class: "form-note" }, `Permanently delete ${person.name} from every tree and remove their relationships? This cannot be undone. Uploaded photo files will be retained.`));
    let confirmation;
    const { form, finish } = formIn(panel, "Permanently delete", async () => {
      if (confirmation.value !== person.name) throw new Error("Enter the person's full name exactly.");
      await api(`/people/${id}`, { revision: data.revision, name: confirmation.value }, "DELETE");
      location.replace(location.pathname);
    });
    panel.footer.querySelector('button[type="submit"]').classList.add("danger");
    confirmation = field(form, "Type their full name to confirm", "", { required: true, max: 200 });
    confirmation.autocomplete = "off";
    finish(); confirmation.focus();
  }
  async function addRelative(id) {
    const p = data.tree.people[id], panel = dialog("Add a relative");
    panel.box.classList.add("add-relative");
    const loading = el("p", { class: "form-note", role: "status" }, "Loading people…"); panel.body.append(loading);
    let people;
    try { people = await api("/people"); }
    catch (error) { loading.textContent = error.message; panel.footer.append(button("Close", () => panel.box.close())); return; }
    if (!panel.box.isConnected) return;
    loading.remove();
    const target = { value: "" };
    let relation, status, fields;
    const { form, finish } = formIn(panel, "Add relative", async () => {
      if (!target.value) throw new Error("Choose an existing person or add a new person.");

      const common = { revision: data.revision, treeId: data.tree.id, relation: relation.value, status: relation.value === "partner" ? status.value : undefined };
      if (target.value !== "new") await api("/relationships", { ...common, personId: id, relativeId: target.value });
      else await api("/people", { ...common, treeId: data.tree.id, relativeId: id, fields: valuesOf(fields) });
      location.reload();
    });
    panel.body.prepend(el("p", { class: "form-note" }, p.name));
    relation = field(form, `Relationship to ${p.name}`, "", { required: true, choices: [["", "Choose relationship"], ["child", "Child"], ["parent", "Parent"], ["partner", "Partner"]] });
    status = field(form, "Partnership", "married", { choices: [["married", "Married"], ["partners", "Partners"]] });
    const statusLabel = form.querySelector(`label[for="${status.id}"]`);
    const summary = el("p", { class: "relative-summary", role: "status", hidden: "" });
    const updateSummary = () => {
      const name = target.value === "new" ? fields.name.value.trim() : people.find(person => person.id === target.value)?.name;
      summary.hidden = !name || !relation.value;
      summary.textContent = name && relation.value ? `${name} will be added as ${p.name}’s ${relation.value}.` : "";
    };
    relation.onchange = () => { status.hidden = statusLabel.hidden = relation.value !== "partner"; updateSummary(); };
    status.hidden = statusLabel.hidden = true;
    const picker = el("div", { class: "person-picker" });
    const search = field(picker, "Person", "", { type: "search" });
    search.placeholder = "Search existing people";
    search.autocomplete = "off";
    const results = el("div", { class: "person-picker-results", "aria-label": "Matching people" });
    const selection = el("div", { class: "person-selection", hidden: "" });
    const choose = (value, name) => {
      target.value = value;
      picker.hidden = true;
      selection.hidden = false;
      selection.replaceChildren(el("span", {}, name), button("Change", () => {
        target.value = ""; picker.hidden = false; selection.hidden = true;
        updateDetails(); search.focus();
      }, "text-button"));
      updateDetails();
    };
    const renderMatches = () => {
      const terms = search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
      const matches = terms.length ? people.filter(other => other.id !== id && terms.every(term => other.name.toLowerCase().includes(term))).slice(0, 20) : [];
      results.replaceChildren(...matches.map(other => button(
        `${other.name}${other.birth_date ? ` · ${other.birth_date}` : ""}`,
        () => choose(other.id, other.name), "person-picker-option")));
      if (terms.length && !matches.length) results.append(el("p", { class: "form-note", role: "status" }, "No matching people."));
    };
    search.oninput = renderMatches;
    picker.append(results, button("Add a new person", () => {
      choose("new", "New person"); fields.name.focus();
    }, "text-button"));
    form.append(picker, selection);
    const details = el("div", { class: "new-person-details" }); fields = detailFields(details, {});
    const more = el("details", { class: "relative-more" }, el("summary", {}, "More details"));
    more.append(...[...details.children].slice(4));
    details.append(more); form.append(details);
    fields.name.oninput = updateSummary;
    function updateDetails() {
      details.hidden = target.value !== "new";
      for (const input of Object.values(fields)) input.disabled = target.value !== "new";
      updateSummary();
    }
    updateDetails();
    form.append(summary);
    finish(); relation.focus();
  }
  async function manageAccess() {
    const panel = dialog("Editor access"), list = el("div");
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
      const account = el("details", { class: "site-menu account-menu" });
      const trigger = el("summary", { class: "account-trigger", title: session.email, "aria-label": `Account: ${session.email}` },
        el("span", { class: "account-avatar", "aria-hidden": "true" }, (session.name || session.email).trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join("").toUpperCase()), icon(["m6 9 6 6 6-6"]));
      if (session.picture) {
        const image = el("img", { src: session.picture, alt: "", referrerpolicy: "no-referrer" });
        image.onload = () => trigger.querySelector(".account-avatar").replaceChildren(image);
      }
      const options = el("div", { class: "menu-items" }, el("div", { class: "account-address" },
        session.name ? el("strong", { class: "account-name" }, session.name) : null, el("span", {}, session.email)),
        button("Sign out of editing", signOut));
      account.append(trigger, options); actions.prepend(account);
    }
    const menu = el("details", { class: "site-menu" }), summary = el("summary", { "aria-label": "Family menu", title: "Family menu" }, icon(["M5 12h.01M12 12h.01M19 12h.01"]));
    const items = el("div", { class: "menu-items" });
    const github = actions.querySelector('a[href*="github.com"]');
    if (github) items.append(el("a", { class: "mobile-menu-item", href: github.href, target: "_blank", rel: "noopener" }, "GitHub"));
    const themeItem = button("Switch light or dark mode", () => { $("theme").click(); menu.open = false; }, "mobile-menu-item");
    items.append(themeItem);
    const item = (label, action) => items.append(button(label, () => { menu.open = false; action(); }));
    const treeId = location.pathname.slice(base.length).match(/^\/trees\/([0-9a-f-]+)\/?$/)?.[1];
    if (treeId) items.append(el("a", { href: `${base}/api/trees/${treeId}/gedcom`, download: "" }, "Download GEDCOM"));
    item("Send a suggestion", () => suggest());
    if (session.role !== "member") item("Family suggestions", inbox);
    if (session.role === "owner") {
      item("Editor access", manageAccess);
      if (session.backup?.error) {
        const notice = el("p", { class: "backup-notice", role: "status" }, session.backup.error);
        items.append(notice);
      }
    }
    if (session.role === "member") item("Sign out", signOut);
    menu.append(summary, items); actions.append(menu);
    document.addEventListener("click", event => { for (const item of actions.querySelectorAll("details")) if (!item.contains(event.target)) item.open = false; });
    document.addEventListener("keydown", event => { if (event.key === "Escape") for (const item of actions.querySelectorAll("details")) item.open = false; });
  }
  async function loadTree() {
    const match = location.pathname.slice(base.length).match(/^\/trees\/([0-9a-f-]+)\/?$/);
    data = await api(`/view${match ? `?tree=${match[1]}` : ""}`);
    $("title").textContent = data.siteName;
    document.title = data.tree ? `${data.tree.name} · ${data.siteName}` : data.siteName;
    if (data.tree) {
      const current = document.querySelector(".current-tree"); current.textContent = data.tree.name; current.href = `${base}/trees/${data.tree.id}`;
      $("tree-options").replaceChildren(...data.trees.map(tree => el("li", {}, el("a", { href: `${base}/trees/${tree.id}`, ...tree.id === data.tree.id ? { "aria-current": "page" } : {} }, tree.name))));
    } else {
      $("family-heading").textContent = `Family trees (${data.trees.length})`;
      $("family-list").replaceChildren(...data.trees.map(tree => el("li", {}, el("a", { class: "tree-card", href: `${base}/trees/${tree.id}` }, el("h3", {}, tree.name), el("p", {}, `${tree.people} ${tree.people === 1 ? "person" : "people"}`)))));
    }
    return data.tree;
  }
  window.familySite = { base, loadTree: async () => { await ready; return loadTree(); }, editPerson,
    canEdit: () => session?.role === "editor" || session?.role === "owner",
    suggestionAction: id => button("Suggest a change", () => suggest(id), "text-button suggest-action"),
    personActions: id => {
      if (session.role === "member") return null;
      const tools = el("div", { class: "person-tools" });
      tools.append(button("Edit details", () => editPerson(id), "site-button primary"), button("Add relative", () => addRelative(id)));
      return tools;
    },
  };
  const ready = new Promise(resolve => document.addEventListener("DOMContentLoaded", async () => {
    try {
      session = await api("/session");
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
