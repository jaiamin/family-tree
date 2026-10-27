// Owner workflows reuse the same dialog/form primitives as person editing.
export function administration({ api, dialog, field, formIn, el, button, base, reload, toast }) {
  function error(panel, failure) {
    let status = panel.body.querySelector(".admin-error");
    if (!status) { status = el("p", { class: "form-status is-error admin-error", role: "alert" }); panel.body.prepend(status); }
    status.textContent = failure.message;
  }
  function loading(panel) {
    const placeholder = el("div", { class: "admin-loading", "aria-label": "Loading", "aria-busy": "true" },
      ...[1, 2].map(() => el("div", { class: "admin-row", "aria-hidden": "true" }, el("span", { class: "skeleton skeleton-medium" }))));
    panel.body.append(placeholder); return () => placeholder.remove();
  }
  const heading = (parent, text) => parent.append(el("h3", { class: "admin-section-title" }, text));
  const listIn = panel => { const list = el("div", { class: "admin-list" }); panel.body.append(list); return list; };
  const row = (name, detail, ...actions) => el("div", { class: "admin-row" },
    el("div", { class: "admin-person" }, el("strong", {}, name), detail ? el("small", {}, detail) : null),
    actions.length ? el("div", { class: "admin-actions" }, ...actions) : null);
  async function change(panel, control, operation) {
    if (panel.box.saving) return;
    panel.box.saving = true;
    const controls = [...panel.box.querySelectorAll("button, input")];
    controls.forEach(item => item.disabled = true);
    const label = control.textContent; control.textContent = "Saving…";
    panel.body.querySelector(".admin-error")?.remove();
    try { await operation(); }
    catch (failure) { error(panel, failure); }
    finally { panel.box.saving = false; controls.forEach(item => item.disabled = false); control.textContent = label; }
  }
  function showSecret(panel, title, note, value, copyLabel) {
    const output = el("textarea", { readonly: "", "aria-label": copyLabel, rows: "3", spellcheck: "false" }); output.value = value;
    panel.box.confirmClose = "Have you saved this key? It won't be shown again.";
    panel.body.replaceChildren(el("p", { class: "admin-success", role: "status" }, title), el("p", { class: "form-note" }, note), output);
    output.focus({ preventScroll: true });
    panel.footer.replaceChildren(button(copyLabel, async () => {
      try {
        await navigator.clipboard.writeText(value); panel.box.confirmClose = "";
        toast("Copied.", "success");
      } catch {
        output.focus(); output.select(); toast("Couldn't copy automatically. Copy the selected key.", "error");
      }
    }, "site-button primary"));
  }
  async function accounts() {
    const panel = dialog("Editor access"); if (!panel) return;
    const done = loading(panel);
    try {
      const users = await api("/users"); done();
      const list = listIn(panel);
      function render() {
        list.replaceChildren(...[...users].sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner") || a.name.localeCompare(b.name)).map(user => {
          if (user.role === "owner") return row(user.name, user.name !== user.email ? user.email : null, el("span", { class: "admin-role" }, "Owner"));
          const action = button(user.enabled ? "Revoke" : "Restore", () => change(panel, action, async () => {
            const enabled = !user.enabled;
            await api(`/users/${user.id}`, { enabled }, "PATCH"); user.enabled = enabled; render();
            toast(enabled ? "Editor access restored." : "Editor access revoked.", "success");
          }), "text-button");
          return row(user.name, `${user.name !== user.email ? `${user.email} · ` : ""}${user.enabled ? "Editor" : "Access revoked"}`, action);
        }));
      }
      render(); heading(panel.body, "Add an editor");
      let email;
      const { form, finish } = formIn(panel, "Add editor", async () => {
        await api("/users", { email: email.value });
        users.splice(0, users.length, ...await api("/users")); render(); email.value = "";
        toast("Editor access saved.", "success");
      }, { cancel: false });
      email = field(form, "Google email", "", { required: true, type: "email" }); finish();
    } catch (failure) { done(); error(panel, failure); }
  }
  async function createTree() {
    const panel = dialog("Create tree"); if (!panel) return;
    const done = loading(panel);
    try {
      const view = await api("/view"); done(); let name;
      const { form, finish } = formIn(panel, "Create tree", async () => {
        await api("/trees", { name: name.value, revision: view.revision }); reload("Tree created.");
      });
      name = field(form, "New tree name", "", { required: true }); finish(); name.focus();
    } catch (failure) { done(); error(panel, failure); }
  }
  function editTree(tree, revision) {
    const panel = dialog("Edit tree"); if (!panel) return;
    let name;
    const { form, finish } = formIn(panel, "Save changes", async () => {
      await api(`/trees/${tree.id}`, { name: name.value, revision }, "PATCH"); reload("Tree saved.");
    });
    name = field(form, "Tree name", tree.name, { required: true }); finish();
    const remove = button("Delete tree grouping", () => deleteTree(tree, revision), "text-button danger");
    panel.body.append(el("div", { class: "delete-person-section" }, remove));
  }
  function deleteTree(tree, revision) {
    const panel = dialog("Delete tree grouping"); if (!panel) return;
    panel.body.append(el("p", { class: "form-note" }, "People and photos stay in the collection. Only this tree grouping is deleted."));
    let confirmation;
    const { form, finish } = formIn(panel, "Delete grouping", async () => {
      if (confirmation.value !== tree.name) throw Error("Enter the tree name exactly to confirm.");
      await api(`/trees/${tree.id}`, { name: confirmation.value, revision }, "DELETE");
      // A deleted tree has no viewer page to reload.
      panel.box.dirty = false; location.href = `${base}/`;
    });
    confirmation = field(form, `Type ${tree.name} to confirm`, "", { required: true }); finish();
    panel.footer.querySelector(".primary").classList.add("danger");
  }
  async function trees() {
    const panel = dialog("Trees and settings"); if (!panel) return;
    const done = loading(panel);
    try {
      const view = await api("/view"); done();
      let name;
      const { form, finish } = formIn(panel, "Save changes", async () => {
        await api("/site", { name: name.value, revision: view.revision }, "PATCH"); reload("Website name saved.");
      }, { cancel: false });
      name = field(form, "Website name", view.siteName, { required: true }); finish();
      const title = el("div", { class: "admin-section-heading" }, el("h3", {}, "Family trees"), button("Create tree", createTree, "text-button"));
      panel.body.append(title);
      const list = listIn(panel);
      list.append(...view.trees.map(tree => row(tree.name, `${tree.people} ${tree.people === 1 ? "person" : "people"}`,
        button("Edit", () => editTree(tree, view.revision), "text-button"))));
      if (!view.trees.length) list.append(el("p", { class: "form-note" }, "No family trees yet."));
    } catch (failure) { done(); error(panel, failure); }
  }
  async function firstPerson(treeId) {
    const panel = dialog("First person"); if (!panel) return;
    try {
      const view = await api("/view"); let name;
      const { form, finish } = formIn(panel, "Add person", async () => { await api("/first-person", { treeId, revision: view.revision, fields: { name: name.value } }); reload(); });
      name = field(form, "Name", "", { required: true }); finish(); name.focus();
    } catch (failure) { error(panel, failure); }
  }
  async function automation() {
    const panel = dialog("Agent access"); if (!panel) return;
    const done = loading(panel);
    try {
      let credentials = await api("/automation"); done();
      const list = listIn(panel);
      function render() {
        list.replaceChildren(...credentials.map(credential => {
          const revoke = button("Revoke", () => {
            if (!confirm(`Revoke access for ${credential.name}? Its agent will stop working.`)) return;
            change(panel, revoke, async () => {
              await api(`/automation/${credential.id}`, undefined, "DELETE"); credentials = credentials.filter(item => item.id !== credential.id); render();
              toast("Agent access revoked.", "success");
            });
          }, "text-button");
          return row(credential.name, "Owner access", revoke);
        }));
        if (!credentials.length) list.append(el("p", { class: "form-note" }, "No agents connected."));
      }
      render(); heading(panel.body, "Connect an agent");
      let name;
      const { form, finish } = formIn(panel, "Create credential", async () => {
        const credential = await api("/automation", { name: name.value });
        showSecret(panel, `Credential created for ${name.value}.`, "Owner access. Copy and save it; shown only once.", credential.token, "Copy credential");
        toast("Agent access saved.", "success");
      }, { cancel: false }); name = field(form, "Agent name", "", { required: true }); finish();
    } catch (failure) { done(); error(panel, failure); }
  }
  async function activity() {
    const panel = dialog("Recent activity"); if (!panel) return;
    panel.footer.remove();
    try {
      const entries = await api("/activity");
      panel.body.append(...entries.map(entry => el("div", { class: "admin-row" }, el("div", {}, el("strong", {}, entry.actor_name), el("p", {}, entry.action), entry.target ? el("small", {}, entry.target) : null), el("small", {}, new Date(`${entry.created_at}Z`).toLocaleString()))));
      if (!entries.length) panel.body.append(el("p", { class: "form-note" }, "No activity yet."));
    } catch (failure) { error(panel, failure); }
  }
  async function importGedcom() {
    const panel=dialog("Import GEDCOM"); if (!panel) return;
    let name, file, preview;
    const {form,finish}=formIn(panel,"Preview import",async()=>{
      const selected=file.files[0];
      if (!selected) throw Error("Choose a GEDCOM file.");
      if (selected.size > 1_000_000) throw Error("Choose a GEDCOM file smaller than 1 MB.");
      const source=await selected.text();
      preview=await api("/imports/preview",{name:name.value,source});
      const view=await api("/view");
      panel.body.replaceChildren(el("p",{},`${preview.people} ${preview.people === 1 ? "person" : "people"} · A new tree will be created.`),...preview.warnings.map(warning=>el("p",{class:"form-note"},warning)));
      const commit = button("Import tree", () => change(panel, commit, async () => {
        await api("/imports/commit", { name: name.value, source, checksum: preview.checksum, revision: view.revision }); reload("Tree imported.");
      }), "site-button primary");
      panel.footer.replaceChildren(commit);
    });
    name=field(form,"Tree name","",{required:true});
    file=field(form,"GEDCOM file","",{type:"file",required:true}); file.accept=".ged,.gedcom,text/plain"; finish();
  }
  async function backups() {
    const panel = dialog("Backups"); if (!panel) return;
    const done = loading(panel);
    try {
      const state = (await api("/session")).backup; done();
      const pending = state && state.saved_generation < state.generation;
      const saved = state?.saved_at ? new Date(`${state.saved_at}Z`).toLocaleString() : "Not saved yet";
      panel.body.append(el("dl", { class: "backup-details" },
        el("dt", {}, "Automatic backup"), el("dd", {}, state?.error ? "Needs attention" : pending ? "Changes pending" : state?.saved_at ? "Up to date" : "Awaiting first backup"),
        el("dt", {}, "Last saved"), el("dd", {}, saved)),
        el("p", { class: "form-note" }, "Latest state and seven daily recovery points."));
      if (state?.error) error(panel, Error(state.error));
      heading(panel.body, "Keep a copy");
      panel.body.append(el("p", { class: "form-note" }, "Download an encrypted backup and save its recovery key separately."));
      const exportButton = button("Export encrypted backup", () => change(panel, exportButton, async () => {
        exportButton.textContent = "Exporting…";
        const bytes = crypto.getRandomValues(new Uint8Array(32)), key = btoa(String.fromCharCode(...bytes));
        const response = await fetch(`${base}/api/backup/export`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key }) });
        if (!response.ok) throw Error((await response.json()).error || "Couldn't export the backup. Please try again.");
        const url = URL.createObjectURL(await response.blob()), link = el("a", { href: url, download: "family-backup.encrypted" });
        link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        showSecret(panel, "Your encrypted backup is ready.", "Save this key separately. You need it to restore the backup.", key, "Copy recovery key");
      }), "site-button primary");
      panel.footer.replaceChildren(exportButton);
    } catch (failure) { done(); error(panel, failure); }
  }
  return { backups, importGedcom, accounts, trees, createTree, firstPerson, automation, activity };
}
