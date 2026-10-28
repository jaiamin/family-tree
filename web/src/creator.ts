import { encryptedBackup } from "./backup-export";
import { previewGedcom } from "./gedcom-import";
import { applyPersonEdit, assert, uuid, validateCollection } from "./model";
import { MAX_IMPORT_BODY_BYTES } from "./import-limits";
import { readCollection, saveCollection, readView } from "./data";
import { requireRole } from "./auth";
import { bodyOf, text } from "./http";
import type { Env, Identity } from "./types";

export async function creatorRoute(request: Request, env: Env, user: Identity, path: string): Promise<Response | null> {
  const method = request.method, treeId = path.match(/^\/api\/trees\/([^/]+)$/)?.[1];
  if (path === "/api/backup/export" && method === "POST") {
    requireRole(user,"owner");
    const body=await bodyOf(request);
    const stream=await encryptedBackup(env,text(body.key,100,true));
    return new Response(stream,{headers:{"content-type":"application/octet-stream","content-disposition":"attachment; filename=family-backup.encrypted"}});
  }
  if (path === "/api/activity" && method === "GET") {
    requireRole(user, "owner");
    return Response.json((await env.DB.prepare("SELECT actor_name,action,target,created_at FROM activity ORDER BY id DESC LIMIT 200").all()).results);
  }
  if (path === "/api/trees" && method === "GET") return Response.json((await readView(env, null)).trees);
  if (path === "/api/imports/preview" || path === "/api/imports/commit") {
    requireRole(user,"owner");
    assert(method === "POST","Method not allowed.",405);
    const body = await bodyOf(request, MAX_IMPORT_BODY_BYTES);
    assert(typeof body.source === "string", "Choose a GEDCOM file.");
    const draft = await previewGedcom(body.source,text(body.name,200,true));
    const {collection,revision} = await readCollection(env);
    const previewing = path.endsWith("preview");
    if (!previewing) {
      assert(body.checksum === draft.checksum,"Preview this file before importing.",409);
      assert(body.revision === revision,"Someone else updated the tree. Preview again.",409);
    }
    Object.assign(collection.people,draft.collection.people); Object.assign(collection.trees,draft.collection.trees); Object.assign(collection.partnerships,draft.collection.partnerships);
    validateCollection(collection);
    if (previewing) return Response.json({people:draft.people,warnings:draft.warnings,checksum:draft.checksum,revision});
    return Response.json({id:draft.treeId,revision:await saveCollection(env,collection,revision,user,"Imported GEDCOM")});
  }
  if (!(path === "/api/site" || path === "/api/trees" || treeId || path === "/api/first-person")) return null;
  requireRole(user, "owner");
  const body = await bodyOf(request), { collection, revision } = await readCollection(env);
  assert(body.revision === revision, "Someone else updated the tree. Reload before saving.", 409);
  let id = treeId;
  if (path === "/api/site" && method === "PATCH") collection.site = { ...collection.site, name: text(body.name, 200, true) };
  else if (path === "/api/trees" && method === "POST") {
    id = crypto.randomUUID();
    collection.trees[id] = { id, name: text(body.name, 200, true), members: [] };
  } else if (treeId && (method === "PATCH" || method === "DELETE")) {
    assert(uuid(treeId) && collection.trees[treeId], "Tree not found.", 404);
    if (method === "PATCH") collection.trees[treeId].name = text(body.name, 200, true);
    else { assert(body.name === collection.trees[treeId].name, "Confirm the tree's name."); delete collection.trees[treeId]; }
  } else if (path === "/api/first-person" && method === "POST") {
    assert(uuid(body.treeId) && collection.trees[body.treeId], "Choose an existing tree.");
    assert(collection.trees[body.treeId].members.length === 0, "This tree already contains people.", 409);
    id = crypto.randomUUID();
    collection.people[id] = { id, name: "", parents: [], partners: [] };
    applyPersonEdit(collection, id, body.fields);
    collection.trees[body.treeId].members.push(id);
  } else return null;
  return Response.json({ id, revision: await saveCollection(env, collection, revision, user, `Updated ${path.split("/")[2]}`) });
}
