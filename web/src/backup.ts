import { collectionFromRows, collectionQueries } from "./data";
import type { Env } from "./types";

// One rolling manifest, plus one backup copy of every immutable photo upload.
// Conditional R2 writes stop a slower, older request overwriting a newer backup.
export async function refreshBackup(env: Env) {
  try {
    const rows = await env.DB.batch<Record<string, unknown>>([
      ...collectionQueries(env),
      env.DB.prepare("SELECT * FROM photos"),
      env.DB.prepare("SELECT * FROM photo_uploads"),
      env.DB.prepare("SELECT * FROM suggestions"),
      env.DB.prepare("SELECT * FROM editors"),
      env.DB.prepare("SELECT generation, saved_generation FROM backup_state WHERE id = 1"),
    ]);
    const state = rows[10].results[0];
    const generation = Number(state.generation);
    if (generation <= Number(state.saved_generation)) return;
    const snapshot = { format: 1, generation, exported_at: new Date().toISOString(), ...collectionFromRows(rows),
      tables: Object.fromEntries(["collections", "people", "parents", "partnerships", "trees", "tree_members", "photos", "photo_uploads", "suggestions", "editors"].map((table, index) => [table, index === 0 ? [{ id: "main", site: rows[0].results[0]?.site ?? null, revision: Number(rows[0].results[0]?.revision || 0), operation: "recovery", actor: "recovery", reason: "Recovered from backup" }] : rows[index].results])),
      photos: rows[6].results, uploads: rows[7].results, suggestions: rows[8].results, editors: rows[9].results };
    for (let attempt = 0; attempt < 3; attempt++) {
      const existing = await env.BACKUP.head("collection.json");
      if (Number(existing?.customMetadata?.generation ?? -1) >= generation) {
        await markSaved(env, generation);
        return;
      }
      const saved = await env.BACKUP.put("collection.json", JSON.stringify(snapshot), {
        onlyIf: existing ? { etagMatches: existing.etag } : { etagDoesNotMatch: "*" },
        httpMetadata: { contentType: "application/json" }, customMetadata: { generation: String(generation) },
      });
      if (!saved) continue;
      await markSaved(env, generation);
      return;
    }
    throw new Error("Backup write contention; retry required");
  } catch {
    console.error(JSON.stringify({ event: "backup_pending" }));
    await env.DB.prepare("UPDATE backup_state SET error = 'The latest backup is pending. It will be retried automatically.' WHERE id = 1").run();
  }
}

async function markSaved(env: Env, generation: number) {
  await env.DB.prepare("UPDATE backup_state SET saved_generation = max(saved_generation, ?), saved_at = CURRENT_TIMESTAMP, error = NULL WHERE id = 1").bind(generation).run();
}
