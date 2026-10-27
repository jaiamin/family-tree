import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function installationConfig(path = process.env.FAMILY_INSTALLATION_CONFIG || "installation.json") {
  const config = JSON.parse(readFileSync(resolve(import.meta.dirname, "..", path), "utf8"));
  for (const key of ["accountId", "workerName", "databaseId", "databaseName", "photosBucket", "backupBucket", "siteName", "publicOrigin"]) {
    if (typeof config[key] !== "string" || !config[key].trim()) throw Error(`Installation requires ${key}.`);
  }
  if (!/^(\/[a-zA-Z0-9_-]+)*$/.test(config.basePath)) throw Error("basePath must be empty or a path without a trailing slash.");
  const url = new URL(config.publicOrigin);
  if (url.protocol !== "https:" || url.origin !== config.publicOrigin) throw Error("publicOrigin must be an HTTPS origin without a path.");
  return config;
}
