import { collectionFromRows } from "./data";
import type { Env } from "./types";
import { assert } from "./model";

export const backupTables = ["collections", "people", "parents", "partnerships", "trees", "tree_members", "photos", "photo_uploads", "suggestions", "users", "identities", "activity", "public_ids"] as const;
export const digest = async (bytes: ArrayBuffer | Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
export type Backup = Awaited<ReturnType<typeof createBackup>>;
export async function createBackup(env: Env) {
  const rows = await env.DB.batch<Record<string, unknown>>([
    ...backupTables.map(table => env.DB.prepare(`SELECT * FROM ${table}${table === "tree_members" ? " ORDER BY position" : ""}`)),
    env.DB.prepare("SELECT generation FROM backup_state WHERE id=1"),
  ]);
  const tables = Object.fromEntries(backupTables.map((table, index) => [table, rows[index].results]));
  const snapshot = { format: 3, schemaVersion: 2, generation: Number(rows[backupTables.length].results[0].generation), exported_at: new Date().toISOString(),
    ...collectionFromRows(rows), tables, uploads: tables.photo_uploads as { object_key: string; content_type: string; content_hash: string }[] };
  return { ...snapshot, checksum: await digest(new TextEncoder().encode(JSON.stringify(snapshot))) };
}
async function writeSnapshot(env: Env, key: string, snapshot: Backup) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await env.BACKUP.head(key);
    if (existing?.customMetadata?.format === "3" && Number(existing.customMetadata.generation) >= snapshot.generation) return;
    const saved = await env.BACKUP.put(key, JSON.stringify(snapshot), {
      onlyIf: existing ? { etagMatches: existing.etag } : { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/json" }, customMetadata: { generation: String(snapshot.generation), format: "3" },
    });
    if (saved) return;
  }
  throw Error("Backup write contention; retry required.");
}
export async function refreshBackup(env: Env) {
  try {
    const snapshot = await createBackup(env);
    // A verified manifest never references a missing backup upload.
    for (const upload of snapshot.uploads) assert(await env.BACKUP.head(upload.object_key), "A retained backup photo is missing.");
    await writeSnapshot(env, "collection.json", snapshot);
    await writeSnapshot(env, `daily/${snapshot.exported_at.slice(0,10)}.json`, snapshot);
    const daily = (await env.BACKUP.list({ prefix: "daily/" })).objects.sort((a,b) => b.key.localeCompare(a.key));
    for (const old of daily.slice(7)) await env.BACKUP.delete(old.key);
    await env.DB.prepare("UPDATE backup_state SET saved_generation=max(saved_generation,?),saved_at=CURRENT_TIMESTAMP,error=NULL WHERE id=1").bind(snapshot.generation).run();
  } catch {
    await env.DB.prepare("UPDATE backup_state SET error='Backup failed. Check the destination; it will be retried automatically.' WHERE id=1").run();
  }
}
export async function verifyBackupPhotos(env: Env, snapshot: Backup) {
  for (const upload of snapshot.uploads) {
    const object = await env.BACKUP.get(upload.object_key);
    assert(object && await digest(await object.arrayBuffer()) === upload.content_hash, "A retained backup photo failed integrity verification.");
  }
}
export async function preUpgradeBackup(env: Env) {
  const version = await env.DB.prepare("SELECT version,maintenance FROM schema_version WHERE id=1").first<{version:number;maintenance:number}>();
  assert(version?.version === 2 && version.maintenance === 1,"Pause the current installation before preflight.",409);
  const snapshot = await createBackup(env);
  await verifyBackupPhotos(env,snapshot);
  const encoded = JSON.stringify(snapshot), candidate = "pre-upgrade.candidate.json";
  try {
    await env.BACKUP.put(candidate,encoded,{httpMetadata:{contentType:"application/json"}});
    const saved = await env.BACKUP.get(candidate);
    assert(saved && await digest(await saved.arrayBuffer()) === await digest(new TextEncoder().encode(encoded)),"Pre-upgrade snapshot verification failed.");
    const state = await env.DB.prepare("SELECT generation FROM backup_state WHERE id=1").first<{generation:number}>();
    assert(state?.generation === snapshot.generation,"Records changed during preflight. Stop writes and repeat.",409);
    // Publish only a verified candidate. Atomic object replacement preserves the
    // previous recovery point if staging, validation or publication fails.
    await env.BACKUP.put("pre-upgrade.json",encoded,{httpMetadata:{contentType:"application/json"}});
  } finally { await env.BACKUP.delete(candidate).catch(()=>{}); }
}
