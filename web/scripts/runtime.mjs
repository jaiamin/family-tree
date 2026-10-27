import { Miniflare } from "miniflare";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
export const root = fileURLToPath(new URL("..", import.meta.url));
export async function runtime(options = {}) {
  const mf = new Miniflare({
    modules: true, scriptPath: `${root}/dist/worker.mjs`, compatibilityDate: "2026-08-06",
    d1Databases: ["DB"], r2Buckets: ["PHOTOS", "BACKUP"],
    bindings: {
      BASE_PATH: "/family-tree", SITE_NAME: "Chha Gam", OWNER_EMAIL: "jaiamin130@gmail.com",
      GOOGLE_CLIENT_ID: "207540522825-6h5fk3lfe0jhcddpbmrm6e1n8i2rur02.apps.googleusercontent.com",
      LOCAL_MODE: "true", FAMILY_PASSWORD: "local-preview-only", MCP_TOKEN: "local-test-owner-token",
      ...options.bindings,
    },
    ...options,
  });
  const db = await mf.getD1Database("DB");
  await db.exec((await readFile(`${root}/schema.sql`, "utf8")).replace(/\n/g, " "));
  await db.prepare("INSERT OR IGNORE INTO editors(email) VALUES (?)").bind("mehul@mehulamin.com").run();
  return mf;
}
