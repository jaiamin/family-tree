// Owner workflows reuse the same dialog/form primitives as person editing.
export function administration({ api, dialog, field, formIn, el, button, base, reload, session }) {
  const error = (panel, failure) => panel.body.append(el("p", { class: "form-status is-error", role: "alert" }, failure.message));
  const showSecret = (panel, label, value) => {
    const output = el("textarea", { readonly: "", "aria-label": label, rows: "3" }); output.value = value;
    panel.body.replaceChildren(el("p", { class: "form-note" }, label), output);
    panel.footer.replaceChildren(button("Copy", async () => { try { await navigator.clipboard.writeText(value); } catch { output.select(); } }));
  };
  async function accounts() {
    const panel = dialog("Editor access"); if (!panel) return;
    const list = el("div", { class: "admin-list" }); panel.body.append(list);
    try {
      for (const user of await api("/users")) {
        const row = el("div", { class: "admin-row" }, el("div", {}, el("strong", {}, user.name), user.name !== user.email ? el("small", {}, user.email) : null));
        if (user.role === "owner") row.append(el("span", {}, "Owner"));
        else row.append(button(user.enabled ? "Revoke" : "Restore", async () => {
          try { await api(`/users/${user.id}`, { enabled: !user.enabled }, "PATCH"); reload(); }
          catch (failure) { error(panel, failure); }
        }, "text-button"));
        list.append(row);
      }
      let email;
      const { form, finish } = formIn(panel, "Add editor", async () => { await api("/users", { email: email.value }); reload(); }, { cancel: false });
      email = field(form, "Google email", "", { required: true, type: "email" }); finish();
    } catch (failure) { error(panel, failure); }
  }
  async function trees() {
    const panel = dialog("Trees and settings"); if (!panel) return;
    try {
      const view = await api("/view");
      let name;
      const { form, finish } = formIn(panel, "Create tree", async () => { await api("/trees", { name: name.value, revision: view.revision }); reload(); }, { cancel: false });
      name = field(form, "New tree name", "", { required: true }); finish();
      const list = el("div", { class: "admin-list" }); panel.body.prepend(list);
      for (const tree of view.trees) {
        const row = el("div", { class: "admin-row" }, el("strong", {}, tree.name));
        row.append(button("Rename", () => renameTree(tree), "text-button"), button("Delete grouping", async () => {
          const confirmation = prompt(`Type ${tree.name} to delete this grouping. People and photos stay in the collection.`);
          if (confirmation !== tree.name) return;
          try { await api(`/trees/${tree.id}`, { name: confirmation, revision: view.revision }, "DELETE"); reload(); }
          catch (failure) { error(panel, failure); }
        }, "text-button")); list.append(row);
      }
      function renameTree(tree) {
        const next = prompt("Tree name", tree.name); if (!next || next === tree.name) return;
        api(`/trees/${tree.id}`, { name: next, revision: view.revision }, "PATCH").then(reload).catch(failure => error(panel, failure));
      }
      const settings = el("form", { class: "admin-settings" });
      const site = field(settings, "Website name", view.siteName, { required: true });
      settings.append(button("Save name", async () => { try { await api("/site", { name: site.value, revision: view.revision }, "PATCH"); reload(); } catch (failure) { error(panel, failure); } })); panel.body.append(settings);
    } catch (failure) { error(panel, failure); }
  }
  async function firstPerson(treeId) {
    const panel = dialog("First person"); if (!panel) return;
    const view = await api("/view"); let name;
    const { form, finish } = formIn(panel, "Add person", async () => { await api("/first-person", { treeId, revision: view.revision, fields: { name: name.value } }); reload(); });
    name = field(form, "Name", "", { required: true }); finish(); name.focus();
  }
  async function automation() {
    const panel = dialog("Agent access"); if (!panel) return;
    try {
      for (const credential of await api("/automation")) panel.body.append(el("div", { class: "admin-row" }, el("strong", {}, credential.name), button("Revoke", async () => {
        try { await api(`/automation/${credential.id}`, undefined, "DELETE"); reload(); } catch (failure) { error(panel, failure); }
      }, "text-button")));
      let name;
      const { form, finish } = formIn(panel, "Create credential", async () => {
        const credential = await api("/automation", { name: name.value }); showSecret(panel, "Owner-level credential. Save it now; it won't be shown again.", credential.token);
      }, { cancel: false }); name = field(form, "Agent name", "", { required: true }); finish();
    } catch (failure) { error(panel, failure); }
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
      panel.footer.replaceChildren(button("Import tree",async()=>{
        try { await api("/imports/commit",{name:name.value,source,checksum:preview.checksum,revision:view.revision}); reload(); }
        catch(failure){error(panel,failure);}
      },"site-button primary"));
    });
    name=field(form,"Tree name","",{required:true});
    file=field(form,"GEDCOM file","",{type:"file",required:true}); file.accept=".ged,.gedcom,text/plain"; finish();
  }
  async function backups() {
    const panel=dialog("Backups"); if (!panel) return;
    const state=(await api("/session")).backup;
    panel.body.append(el("p",{},state?.saved_at ? `Last saved: ${new Date(`${state.saved_at}Z`).toLocaleString()}` : "No successful backup yet."),el("p",{class:"form-note"},state?.error || (state && state.saved_generation < state.generation ? "Changes are awaiting backup. Keep an off-device copy." : "Latest state and seven daily recovery points. Keep an off-device copy.")));
    panel.footer.replaceChildren(button("Export encrypted backup",async()=>{
      try {
        const bytes=crypto.getRandomValues(new Uint8Array(32)), key=btoa(String.fromCharCode(...bytes));
        const response=await fetch(`${base}/api/backup/export`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key})});
        if (!response.ok) throw Error((await response.json()).error);
        const url=URL.createObjectURL(await response.blob()), link=el("a",{href:url,download:"family-backup.encrypted"}); link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
        showSecret(panel,"Save this recovery key separately from the downloaded backup. Without it the export cannot be restored.",key);
      } catch(failure) {error(panel,failure);}
    }));
  }
  return { backups, importGedcom, accounts, trees, firstPerson, automation, activity, showSecret };
}
