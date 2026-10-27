import { assert } from "./model";
import type { Env } from "./types";

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const shortIdPattern = "[1-9A-HJ-NP-Za-km-z]{12}";
export const isShortId = (value: unknown): value is string => typeof value === "string" && new RegExp(`^${shortIdPattern}$`).test(value);
export interface PublicId { kind: "tree" | "person"; entity_id: string; short_id: string }

export function randomShortId() {
  let id = "";
  while (id.length < 12) {
    for (const byte of crypto.getRandomValues(new Uint8Array(24))) {
      if (byte < 232 && id.length < 12) id += alphabet[byte % alphabet.length];
    }
  }
  return id;
}

export async function planPublicIds(env: Pick<Env, "DB">, collection: { people: Record<string, unknown>; trees: Record<string, unknown> }, generate = randomShortId) {
  const { results } = await env.DB.prepare("SELECT * FROM public_ids").all<PublicId>();
  const existing = new Set(results.map(row => `${row.kind}:${row.entity_id}`));
  const used = new Set(results.map(row => row.short_id));
  const additions: PublicId[] = [];
  for (const [kind, entities] of [["person", collection.people], ["tree", collection.trees]] as const) {
    for (const entity_id of Object.keys(entities)) {
      if (existing.has(`${kind}:${entity_id}`)) continue;
      let short_id = "";
      for (let attempt = 0; attempt < 64; attempt++) {
        const candidate = generate();
        assert(isShortId(candidate), "Invalid public ID generator.", 500);
        if (!used.has(candidate)) { short_id = candidate; break; }
      }
      assert(short_id, "Couldn't assign a unique public ID. Please try again.", 503);
      used.add(short_id); additions.push({ kind, entity_id, short_id });
    }
  }
  return additions;
}

export const publicIdCollision = (error: unknown) => error instanceof Error && /UNIQUE constraint failed: public_ids.short_id/.test(error.message);

// Explicit, rerunnable backfill. Never updates an existing ID or family record.
export async function migratePublicIds(env: Pick<Env, "DB">, generate = randomShortId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [people, trees] = await env.DB.batch<{ id: string }>([
      env.DB.prepare("SELECT id FROM people"), env.DB.prepare("SELECT id FROM trees"),
    ]);
    const collection = { people: Object.fromEntries(people.results.map(row => [row.id, {}])), trees: Object.fromEntries(trees.results.map(row => [row.id, {}])) };
    const additions = await planPublicIds(env, collection, generate);
    try {
      if (additions.length) await env.DB.prepare(`INSERT INTO public_ids(kind,entity_id,short_id)
        SELECT json_extract(value,'$.kind'),json_extract(value,'$.entity_id'),json_extract(value,'$.short_id') FROM json_each(?)
        WHERE (json_extract(value,'$.kind') = 'person' AND EXISTS (SELECT 1 FROM people WHERE id = json_extract(value,'$.entity_id')))
          OR (json_extract(value,'$.kind') = 'tree' AND EXISTS (SELECT 1 FROM trees WHERE id = json_extract(value,'$.entity_id')))
        ON CONFLICT(kind,entity_id) DO NOTHING`).bind(JSON.stringify(additions)).run();
      return additions.length;
    } catch (error) { if (!publicIdCollision(error) || attempt === 2) throw error; }
  }
  return 0;
}
