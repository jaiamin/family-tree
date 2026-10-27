// Explicit maintenance command. Reads existing records; writes only public_ids and its schema.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { migratePublicIds } from "../dist/public-ids.mjs";

const [account, database] = process.argv.slice(2);
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !database || !token) throw new Error("Usage: CLOUDFLARE_API_TOKEN=<D1-scoped credential> node scripts/migrate-public-ids.mjs ACCOUNT_ID DATABASE_ID");
async function query(body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || !result.success || result.result.some(row => !row.success)) throw new Error(`D1 migration request failed (${response.status}). Check D1 permissions and database settings.`);
  return result.result;
}
const prepare = sql => {
  let params = [];
  return { bind(...values) { params = values; return this; },
    all: async () => (await query({ sql, params }))[0],
    run: async () => (await query({ sql, params }))[0],
    toQuery: () => ({ sql, params }) };
};
const DB = { prepare, batch: statements => query({ batch: statements.map(statement => statement.toQuery()) }) };
const tables = ["collections", "people", "trees", "parents", "partnerships", "tree_members", "photos", "photo_uploads", "suggestions", "editors"];
async function fingerprint() {
  const rows = await DB.batch(tables.map(table => prepare(`SELECT * FROM ${table} ORDER BY rowid`)));
  return { hash: createHash("sha256").update(JSON.stringify(rows.map(row => row.results))).digest("hex"),
    counts: Object.fromEntries(tables.map((table, index) => [table, rows[index].results.length])) };
}
const before = await fingerprint();
await query({ sql: await readFile(new URL("../migrations/0001_public_ids.sql", import.meta.url), "utf8") });
const assigned = await migratePublicIds({ DB });
const after = await fingerprint();
if (before.hash !== after.hash) throw new Error("Family records changed during migration. Verify concurrent edits before deploying. No family records are written by this command.");
console.log(JSON.stringify({ assigned, preserved: after.counts }));
