import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function validatePublicSettings({ publicOrigin, basePath }) {
  if (typeof basePath !== "string" || !/^(\/[a-zA-Z0-9_-]+)*$/.test(basePath)) throw Error("basePath must be empty or a path without a trailing slash.");
  let url;
  try { url = new URL(publicOrigin); } catch { throw Error("publicOrigin must be an HTTPS origin without a path."); }
  if (url.protocol !== "https:" || url.origin !== publicOrigin) throw Error("publicOrigin must be an HTTPS origin without a path.");
}

export function installationConfig(path) {
  const file = path || process.env.FAMILY_INSTALLATION_CONFIG;
  const input = !file && process.env.FAMILY_INSTALLATION_CONFIG_JSON;
  const config = JSON.parse(input || readFileSync(resolve(import.meta.dirname, "..", file || "installation.json"), "utf8"));
  for (const key of ["accountId", "workerName", "databaseId", "databaseName", "photosBucket", "backupBucket", "siteName", "publicOrigin", "ownerEmail", "googleClientId"]) {
    if (typeof config[key] !== "string" || !config[key].trim()) throw Error(`Installation requires ${key}.`);
  }
  validatePublicSettings(config);
  return config;
}
