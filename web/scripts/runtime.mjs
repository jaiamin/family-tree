import { migratePublicIds } from "../dist/public-ids.mjs";
import { Miniflare } from "miniflare";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
export const root = fileURLToPath(new URL("..", import.meta.url));
export async function runtime(options = {}) {
  const mf = new Miniflare({
    ...options,
    modules: true, scriptPath: `${root}/dist/worker.mjs`, compatibilityDate: "2026-08-06",
    d1Databases: ["DB"], r2Buckets: ["PHOTOS", "BACKUP"],
    bindings: { BASE_PATH: "/family-tree", SITE_NAME: "Family Tree", DEVELOPMENT: "true", SETUP_TOKEN: "local-setup-only", ...options.bindings },
  });
  const db = await mf.getD1Database("DB");
  await db.exec((await readFile(`${root}/schema.sql`, "utf8")).replace(/\n/g, " "));
  await db.exec((await readFile(`${root}/migrations/0001_public_ids.sql`, "utf8")).replace(/\n/g, " "));
  await migratePublicIds({ DB: db });
  return mf;
}
