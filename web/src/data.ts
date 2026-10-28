import { planPublicIds, publicIdCollision, isShortId, type PublicId } from "./public-ids";
import { assert, emptyCollection, pair, validateCollection, type Collection, type Person, type Family } from "./model";
import type { Env, Identity } from "./types";
export interface Snapshot { collection: Collection; revision: number }
export const collectionQueries = (env: Env) => [
    env.DB.prepare("SELECT site, revision FROM collections WHERE id = 'main'"),
    env.DB.prepare("SELECT * FROM people ORDER BY rowid"),
    env.DB.prepare("SELECT * FROM parents ORDER BY rowid"),
    env.DB.prepare("SELECT * FROM partnerships ORDER BY rowid"),
    env.DB.prepare("SELECT * FROM trees ORDER BY rowid"),
    env.DB.prepare("SELECT * FROM tree_members ORDER BY position"),
  ];
export function collectionFromRows(rows: import("./platform/storage").QueryResult<Record<string, unknown>>[]): Snapshot {
  const c = emptyCollection();
  const meta = rows[0].results[0];
  c.site = meta?.site ? JSON.parse(String(meta.site)) : null;
  for (const row of rows[1].results) c.people[String(row.id)] = { ...row, parents: [], partners: [] } as unknown as Person;
  for (const row of rows[2].results) c.people[String(row.child_id)].parents.push(String(row.parent_id));
  for (const row of rows[3].results) {
    const a = String(row.person_a), b = String(row.person_b);
    c.people[a].partners.push(b); c.people[b].partners.push(a);
    if (row.has_details) c.partnerships[pair(a,b)] = {
      status: row.status as string | null, marriage_date: row.marriage_date as string | null,
      marriage_place: row.marriage_place as string | null, divorce_date: row.divorce_date as string | null,
    };
  }
  for (const row of rows[4].results) c.trees[String(row.id)] = { ...row, members: [] } as unknown as Family;
  for (const row of rows[5].results) c.trees[String(row.tree_id)].members.push(String(row.person_id));
  return { collection: c, revision: Number(meta?.revision || 0) };
}
export async function readCollection(env: Env): Promise<Snapshot> {
  return collectionFromRows(await env.DB.batch<Record<string, unknown>>(collectionQueries(env)));
}
// Overview reads only summary rows. A tree and its photo pointers share one D1 snapshot.
export async function readView(env: Env, id: string | null) {
  if (!id) {
    const [meta, trees] = await env.DB.batch<Record<string, unknown>>([
      env.DB.prepare("SELECT site, revision FROM collections WHERE id = 'main'"),
      env.DB.prepare("SELECT t.id, t.name, p.short_id, count(m.person_id) AS people FROM trees t LEFT JOIN public_ids p ON p.kind = 'tree' AND p.entity_id = t.id LEFT JOIN tree_members m ON m.tree_id = t.id GROUP BY t.id ORDER BY t.rowid"),
    ]);
    assert(trees.results.every(tree => isShortId(tree.short_id)), "Public ID migration is incomplete.", 503);
    const row = meta.results[0];
    return { siteName: row?.site ? JSON.parse(String(row.site))?.name || env.SITE_NAME : env.SITE_NAME,
      revision: Number(row?.revision || 0), trees: trees.results, tree: null };
  }
  assert(isShortId(id), "Family tree not found.", 404);
  const rows = await env.DB.batch<Record<string, unknown>>([
    ...collectionQueries(env),
    env.DB.prepare("SELECT p.person_id, p.version FROM photos p JOIN tree_members m ON m.person_id = p.person_id WHERE m.tree_id = (SELECT entity_id FROM public_ids WHERE kind = 'tree' AND short_id = ?)").bind(id),
    env.DB.prepare("SELECT * FROM public_ids"),
  ]);
  const { collection: c, revision } = collectionFromRows(rows);
  const mappings = rows[7].results as unknown as PublicId[];
  const publicIds = new Map(mappings.map(row => [`${row.kind}:${row.entity_id}`, row.short_id]));
  const treeId = mappings.find(row => row.kind === "tree" && row.short_id === id)?.entity_id;
  assert(treeId && c.trees[treeId], "Family tree not found.", 404);
  const view = treeView(c, treeId, env.SITE_NAME);
  const publicId = (kind: string, uuid: string) => {
    const value = publicIds.get(`${kind}:${uuid}`);
    assert(value, "Public ID migration is incomplete.", 503);
    return value;
  };
  return { siteName: c.site?.name || env.SITE_NAME, revision,
    trees: Object.values(c.trees).map(t => ({ id: t.id, short_id: publicId("tree", t.id), name: t.name, people: t.members.length })),
    tree: { ...view, short_id: publicId("tree", treeId),
      people: Object.fromEntries(Object.entries(view.people).map(([uuid, p]) => [uuid, { ...p, short_id: publicId("person", uuid),
        other_trees: p.other_trees.map(t => ({ ...t, short_id: publicId("tree", t.id) })) }])), photo_versions: Object.fromEntries(rows[6].results.map(p => [String(p.person_id), String(p.version)])) } };
}
// D1 limits each string binding to 2 MB. All bounded chunks still execute
// inside the same atomic, revision-guarded batch.
function jsonChunks(rows: unknown[]): string[] {
  const chunks: string[] = [], encoder = new TextEncoder();
  let items: string[] = [], bytes = 2;
  for (const row of rows) {
    const encoded = JSON.stringify(row), size = encoder.encode(encoded).byteLength;
    assert(size + 2 <= 500_000, "A family record is too large to save.");
    if (bytes + size + (items.length ? 1 : 0) > 500_000) {
      chunks.push(`[${items.join(",")}]`); items = []; bytes = 2;
    }
    bytes += size + (items.length ? 1 : 0); items.push(encoded);
  }
  if (items.length) chunks.push(`[${items.join(",")}]`);
  return chunks;
}
function removed<T>(before: T[], after: T[], key: (row: T) => string): T[] {
  const retained = new Set(after.map(key));
  return before.filter(row => !retained.has(key(row)));
}
const parentRows = (c: Collection) => Object.values(c.people).flatMap(p => p.parents.map(parent => [p.id, parent]));
const partnerRows = (c: Collection) => Object.values(c.people).flatMap(p => p.partners.filter(other => p.id < other).map(other => ({ a: p.id, b: other, ...c.partnerships[pair(p.id, other)], has_details: c.partnerships[pair(p.id, other)] ? 1 : 0 })));
const memberRows = (c: Collection) => Object.values(c.trees).flatMap(t => t.members.map((id, position) => [t.id, id, position] as const));

async function saveCollectionOnce(env: Env, collection: unknown, revision: unknown, user: Identity, reason: string) {
  validateCollection(collection);
  assert(typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0, "A current revision is required.", 409);
  const previous = await readCollection(env);
  assert(previous.revision === revision, "Someone else updated the family tree. Reload before saving.", 409);
  const additions = await planPublicIds(env, collection);
  const operation = crypto.randomUUID(), actor = user.email || "Family member";
  const people = Object.values(collection.people).map(p => ({ id: p.id, name: p.name, sex: p.sex ?? null,
    birth_date: p.birth_date ?? null, death_date: p.death_date ?? null, birth_place: p.birth_place ?? null, notes: p.notes ?? null }));
  const trees = Object.values(collection.trees).map(t => ({ id: t.id, name: t.name, description: t.description ?? "" }));
  const parents = parentRows(collection), partnerships = partnerRows(collection), members = memberRows(collection);
  const removedPeople = removed(Object.keys(previous.collection.people), Object.keys(collection.people), id => id);
  const removedTrees = removed(Object.keys(previous.collection.trees), Object.keys(collection.trees), id => id);
  const removedParents = removed(parentRows(previous.collection), parents, row => row.join("+"));
  const removedPartners = removed(partnerRows(previous.collection), partnerships, row => pair(row.a, row.b));
  const removedMembers = removed(memberRows(previous.collection), members, row => `${row[0]}+${row[1]}`);
  const guard = "(SELECT operation FROM collections WHERE id = 'main') = ?";
  const statement = (sql: string, ...values: (string | number | null)[]) => env.DB.prepare(sql).bind(...values);
  const chunked = (sql: string, rows: unknown[], before = false) => jsonChunks(rows).map(json => statement(sql, ...(before ? [operation, json] : [json, operation])));
  const results = await env.DB.batch([
    statement("INSERT OR IGNORE INTO collections(id, site, operation, actor, reason) VALUES ('main', NULL, 'initial', 'setup', 'Initial collection')"),
    statement("UPDATE collections SET site = ?, revision = revision + 1, operation = ?, actor = ?, reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 'main' AND revision = ? RETURNING revision", collection.site === null ? null : JSON.stringify(collection.site), operation, actor, reason, revision),
    ...chunked(`DELETE FROM parents WHERE ${guard} AND (child_id, parent_id) IN (SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?))`, removedParents, true),
    ...chunked(`DELETE FROM partnerships WHERE ${guard} AND (person_a, person_b) IN (SELECT json_extract(value,'$.a'),json_extract(value,'$.b') FROM json_each(?))`, removedPartners, true),
    ...chunked(`DELETE FROM tree_members WHERE ${guard} AND (tree_id, person_id) IN (SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?))`, removedMembers, true),
    ...chunked(`DELETE FROM people WHERE ${guard} AND id IN (SELECT value FROM json_each(?))`, removedPeople, true),
    ...chunked(`DELETE FROM photos WHERE ${guard} AND person_id IN (SELECT value FROM json_each(?))`, removedPeople, true),
    ...chunked(`DELETE FROM trees WHERE ${guard} AND id IN (SELECT value FROM json_each(?))`, removedTrees, true),
    ...chunked(`INSERT INTO people(id,name,sex,birth_date,death_date,birth_place,notes)
      SELECT json_extract(value,'$.id'),json_extract(value,'$.name'),json_extract(value,'$.sex'),json_extract(value,'$.birth_date'),json_extract(value,'$.death_date'),json_extract(value,'$.birth_place'),json_extract(value,'$.notes') FROM json_each(?) WHERE ${guard}
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,sex=excluded.sex,birth_date=excluded.birth_date,death_date=excluded.death_date,birth_place=excluded.birth_place,notes=excluded.notes
      WHERE name IS NOT excluded.name OR sex IS NOT excluded.sex OR birth_date IS NOT excluded.birth_date OR death_date IS NOT excluded.death_date OR birth_place IS NOT excluded.birth_place OR notes IS NOT excluded.notes`, people),
    ...chunked(`INSERT INTO trees(id,name,description) SELECT json_extract(value,'$.id'),json_extract(value,'$.name'),coalesce(json_extract(value,'$.description'),'') FROM json_each(?) WHERE ${guard}
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description WHERE name IS NOT excluded.name OR description IS NOT excluded.description`, trees),
    ...chunked(`INSERT OR IGNORE INTO parents(child_id,parent_id) SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?) WHERE ${guard}`, parents),
    ...chunked(`INSERT INTO partnerships(person_a,person_b,status,marriage_date,marriage_place,divorce_date,has_details)
      SELECT json_extract(value,'$.a'),json_extract(value,'$.b'),json_extract(value,'$.status'),json_extract(value,'$.marriage_date'),json_extract(value,'$.marriage_place'),json_extract(value,'$.divorce_date'),json_extract(value,'$.has_details') FROM json_each(?) WHERE ${guard}
      ON CONFLICT(person_a,person_b) DO UPDATE SET status=excluded.status,marriage_date=excluded.marriage_date,marriage_place=excluded.marriage_place,divorce_date=excluded.divorce_date,has_details=excluded.has_details
      WHERE status IS NOT excluded.status OR marriage_date IS NOT excluded.marriage_date OR marriage_place IS NOT excluded.marriage_place OR divorce_date IS NOT excluded.divorce_date OR has_details != excluded.has_details`, partnerships),
    ...chunked(`INSERT INTO tree_members(tree_id,person_id,position) SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]') FROM json_each(?) WHERE ${guard}
      ON CONFLICT(tree_id,person_id) DO UPDATE SET position=excluded.position WHERE position != excluded.position`, members),
    ...chunked(`INSERT INTO public_ids(kind,entity_id,short_id) SELECT json_extract(value,'$.kind'),json_extract(value,'$.entity_id'),json_extract(value,'$.short_id') FROM json_each(?) WHERE ${guard} ON CONFLICT(kind,entity_id) DO NOTHING`, additions),
    env.DB.prepare(`INSERT INTO activity(actor_id,actor_name,action,target) SELECT ?,?,?,? WHERE ${guard}`).bind(user.automationId || user.id,user.name,"genealogy.updated",reason,operation),
    env.DB.prepare("DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY id DESC LIMIT 1000)"),
  ]);
  assert(results[1].results.length === 1, "Someone else updated the family tree. Reload before saving.", 409);
  return revision + 1;
}
export async function saveCollection(env: Env, collection: unknown, revision: unknown, user: Identity, reason: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await saveCollectionOnce(env, collection, revision, user, reason); }
    catch (error) { if (!publicIdCollision(error) || attempt === 2) throw error; }
  }
  throw new Error("Couldn't assign public IDs.");
}
export function treeView(c: Collection, id: string, siteName: string) {
  const family = c.trees[id];
  assert(family, "Family tree not found.", 404);
  const members = new Set(family.members);
  const people = Object.fromEntries(family.members.map(id => {
    const p = structuredClone(c.people[id]);
    p.parents = p.parents.filter(id => members.has(id));
    p.partners = p.partners.filter(id => members.has(id));
    const other_trees = Object.values(c.trees).filter(t => t.id !== family.id && t.members.includes(id)).map(t => ({ id: t.id, name: t.name }));
    return [id, { ...p, other_trees }];
  }));
  return { id, name: family.name, description: family.description || "", people, photos: true, site_name: c.site?.name || siteName,
    partnerships: Object.fromEntries(Object.entries(c.partnerships).filter(([key]) => key.split("+").every(id => members.has(id)))) };
}
