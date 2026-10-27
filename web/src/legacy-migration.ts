import { backupTables, digest } from "./backup";
import { collectionFromRows } from "./data";
import { assert, validateCollection } from "./model";
import { recoverBackup } from "./recovery";
import { hashPassword } from "./accounts/password";
import type { Env } from "./types";

const legacyTables = ["collections", "people", "parents", "partnerships", "trees", "tree_members", "photos", "photo_uploads", "suggestions", "editors", "public_ids"];
async function capture(source: Env) {
  const rows = await source.DB.batch(legacyTables.map(table => source.DB.prepare(`SELECT * FROM ${table}${table === "tree_members" ? " ORDER BY position" : " ORDER BY rowid"}`)));
  return { rows, fingerprint: await digest(new TextEncoder().encode(JSON.stringify(rows.map(row => row.results)))) };
}

// One-time, maintenance-only conversion. The source is read-only; the destination
// must be fresh. This is deliberately absent from the serving application's routes.
export async function migrateLegacy(source: Env, destination: Env) {
  const before = await capture(source);
  const { collection, revision } = collectionFromRows(before.rows);
  validateCollection(collection);
  assert(!(await destination.DB.prepare("SELECT id FROM collections LIMIT 1").first()) && !(await destination.DB.prepare("SELECT id FROM users LIMIT 1").first()), "Migration requires a fresh destination.", 409);
  assert(!(await destination.BACKUP.list()).objects.length, "Migration requires an empty destination backup.", 409);
  const tables: Record<string, Record<string, unknown>[]> = Object.fromEntries(backupTables.map(table => [table, []]));
  legacyTables.forEach((table, i) => { if (table !== "editors") tables[table] = before.rows[i].results; });
  // Email approval never becomes a Google identity. Previous editors remain
  // disabled until the new owner explicitly restores and invites their account.
  const editors = before.rows[9].results;
  for (const editor of editors) {
    const id = crypto.randomUUID();
    tables.users.push({ id, username: `relative-${id.slice(0,8)}`, name: editor.name || editor.email, email: editor.email,
      picture: null, role: "editor", enabled: 0, password_hash: await hashPassword(crypto.randomUUID()),
      recovery_hash: null, auth_version: 1, created_at: new Date().toISOString() });
  }
  const hashes: Record<string, string> = {};
  for (const upload of tables.photo_uploads) {
    const key = String(upload.object_key);
    const primary = await source.PHOTOS.get(key), backup = await source.BACKUP.get(key);
    assert(primary && backup, "A retained legacy photo is missing from primary or backup storage.");
    const bytes = await primary.arrayBuffer(), hash = await digest(bytes);
    assert(hash === await digest(await backup.arrayBuffer()), "Legacy primary and backup photo bytes disagree.");
    upload.content_hash = hash; hashes[key] = hash;
    await destination.BACKUP.put(key, bytes, { httpMetadata: { contentType: String(upload.content_type) } });
  }
  const content = { format: 3, schemaVersion: 2, generation: 0, exported_at: new Date().toISOString(), collection, revision, tables, uploads: tables.photo_uploads };
  await destination.BACKUP.put("collection.json", JSON.stringify({ ...content, checksum: await digest(new TextEncoder().encode(JSON.stringify(content))) }));
  const after = await capture(source);
  assert(before.fingerprint === after.fingerprint, "Source changed during rehearsal. Freeze writes and repeat into fresh storage.", 409);
  for (const [key, hash] of Object.entries(hashes)) {
    const primary = await source.PHOTOS.get(key), backup = await source.BACKUP.get(key);
    assert(primary && backup && await digest(await primary.arrayBuffer()) === hash && await digest(await backup.arrayBuffer()) === hash, "Source photos changed during rehearsal.", 409);
  }
  const restored = await recoverBackup(destination);
  return { ...restored, trees: Object.keys(collection.trees).length, pendingAccounts: editors.length, revision, sourceFingerprint: before.fingerprint };
}
