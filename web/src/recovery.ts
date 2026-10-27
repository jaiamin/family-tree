import { isShortId } from "./public-ids";
import type { Env } from "./types";
import { assert, validateCollection } from "./model";

// Maintenance-only operation: never exposed through a browser or public API.
// Use a fresh database and primary bucket; the backup bucket is read-only here.
export async function recoverBackup(env: Env) {
  const object = await env.BACKUP.get("collection.json");
  assert(object, "No backup is available.");
  const snapshot = await object.json<{
    format: number; collection: unknown;
    tables: Record<string, Record<string, string | number | null>[]>;
    uploads: { object_key: string; content_type: string }[];
  }>();
  assert(snapshot.format === 2 && snapshot.tables, "Unsupported backup format.");
  validateCollection(snapshot.collection);
  const mappings = snapshot.tables.public_ids;
  assert(Array.isArray(mappings), "Backup is missing public IDs.");
  const keys = new Set(), shortIds = new Set();
  for (const row of mappings) {
    assert((row.kind === "person" || row.kind === "tree") && isShortId(row.short_id), "Invalid backup public IDs.");
    const entity = row.kind === "person" ? snapshot.collection.people : snapshot.collection.trees;
    const key = `${row.kind}:${row.entity_id}`;
    assert(entity[String(row.entity_id)] && !keys.has(key) && !shortIds.has(row.short_id), "Invalid backup public IDs.");
    keys.add(key); shortIds.add(row.short_id);
  }
  assert(keys.size === Object.keys(snapshot.collection.people).length + Object.keys(snapshot.collection.trees).length, "Backup public IDs are incomplete.");
  const columns: Record<string, string[]> = {
    collections: ["id", "site", "revision", "operation", "actor", "reason"],
    people: ["id", "name", "sex", "birth_date", "death_date", "birth_place", "notes"],
    parents: ["child_id", "parent_id"],
    partnerships: ["person_a", "person_b", "status", "marriage_date", "marriage_place", "divorce_date", "has_details"],
    trees: ["id", "name", "description"], tree_members: ["tree_id", "person_id", "position"],
    photos: ["person_id", "object_key", "version"],
    photo_uploads: ["id", "person_id", "object_key", "content_type", "uploaded_at"],
    suggestions: ["id", "person_id", "person_name", "sender_name", "contact", "message", "status", "created_at"],
    editors: ["email"], public_ids: ["kind", "entity_id", "short_id"],
  };
  const tables = Object.keys(columns);
  const counts = await env.DB.batch<{ n: number }>(tables.map(table => env.DB.prepare(`SELECT count(*) AS n FROM ${table}`)));
  assert(counts.every(result => result.results[0].n === 0), "Recovery requires an empty database.", 409);
  // Check every original before changing the destination. A missing copy fails visibly.
  for (const upload of snapshot.uploads) {
    const original = await env.BACKUP.head(upload.object_key);
    assert(original, "A backup photo is missing. Recovery stopped.");
    const existing = await env.PHOTOS.head(upload.object_key);
    assert(!existing || existing.etag === original.etag, "Destination contains a conflicting photo. Recovery stopped.", 409);
  }
  for (const upload of snapshot.uploads) {
    const photo = await env.BACKUP.get(upload.object_key);
    assert(photo, "A backup photo is missing. Recovery stopped.");
    await env.PHOTOS.put(upload.object_key, await photo.arrayBuffer(), { httpMetadata: photo.httpMetadata });
  }
  const statements = tables.map(table => {
    assert(Array.isArray(snapshot.tables[table]), "Incomplete backup.");
    const names = columns[table];
    return env.DB.prepare(
      `INSERT INTO ${table} (${names.join(",")}) SELECT ${names.map(name => `json_extract(value, '$.${name}')`).join(",")} FROM json_each(?)`,
    ).bind(JSON.stringify(snapshot.tables[table]));
  });
  // D1 batch is atomic: records and current photo pointers appear together.
  if (statements.length) await env.DB.batch(statements);
  return { people: Object.keys((snapshot.collection as { people: object }).people).length, photos: snapshot.uploads.length };
}
