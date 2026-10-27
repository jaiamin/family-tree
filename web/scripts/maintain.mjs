import { readFile, writeFile, open } from "node:fs/promises";
import { Readable } from "node:stream";
import { localRuntime } from "./server.mjs";
import { preUpgradeBackup } from "../dist/maintenance/backup.js";
import { recoverBackup } from "../dist/maintenance/recovery.js";
import { encryptedBackup, stageEncryptedBackup } from "../dist/maintenance/backup-export.js";
import { hashPassword } from "../dist/maintenance/accounts/password.js";
import { sha256 } from "../dist/maintenance/auth.js";

const command = process.argv[2];
const remote = process.env.DEPLOYMENT === "cloudflare";
if (!["init","preflight","export","restore","recover-owner","migrate-legacy","pause","resume"].includes(command)) throw Error("Commands: init, preflight, export, restore, recover-owner, migrate-legacy, pause, resume. Configure DATA_DIR, BACKUP_DIR and PUBLIC_ORIGIN through the environment.");
function required(name) {
  if (!process.env[name]) throw Error(`Set ${name}.`);
  return process.env[name];
}
async function remoteRuntime(path) {
  const { installationConfig } = await import("./config.mjs");
  const { cloudflareStorage } = await import("./cloudflare-storage.mjs");
  return { env: cloudflareStorage(installationConfig(path)), close: async () => {} };
}
const runtime = remote ? await remoteRuntime() : await localRuntime({directory:process.env.DATA_DIR || "/data",backupDirectory:process.env.BACKUP_DIR,
  origin:process.env.PUBLIC_ORIGIN,basePath:process.env.BASE_PATH ?? "/family-tree",initialize:command === "init"});
try {
  if (remote && command === "init") {
    const tables = await runtime.env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all();
    if (tables.results.length) throw Error("Initialization requires a fresh database.");
    await runtime.env.DB.execute(await readFile(new URL("../schema.sql",import.meta.url),"utf8"));
  }
  if (command === "pause" || command === "resume") {
    const changed = await runtime.env.DB.prepare("UPDATE schema_version SET maintenance=? WHERE id=1 AND version=2 RETURNING id").bind(command === "pause" ? 1 : 0).all();
    if (changed.results.length !== 1) throw Error("Unsupported installation version.");
  }
  if (command === "migrate-legacy") {
    const source = remote ? await remoteRuntime(required("LEGACY_INSTALLATION_CONFIG"))
      : await localRuntime({ directory: required("LEGACY_DATA_DIR"), backupDirectory: process.env.LEGACY_BACKUP_DIR, origin: process.env.PUBLIC_ORIGIN });
    try {
      const { migrateLegacy } = await import("../dist/maintenance/legacy-migration.js");
      console.log(JSON.stringify(await migrateLegacy(source.env,runtime.env)));
    } finally { await source.close(); }
  }
  if (command === "preflight") await preUpgradeBackup(runtime.env);
  if (command === "export") {
    if(!process.env.EXPORT_FILE || !process.env.RECOVERY_KEY_FILE) throw Error("Set EXPORT_FILE and RECOVERY_KEY_FILE to separate private destinations.");
    const key=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
    await writeFile(process.env.RECOVERY_KEY_FILE,key,{mode:0o600,flag:"wx"});
    const file=await open(process.env.EXPORT_FILE,"wx",0o600);
    try { for await(const chunk of await encryptedBackup(runtime.env,key)) await file.writeFile(chunk); await file.sync(); }
    finally {await file.close();}
  }
  if(command === "restore") {
    if(!process.env.EXPORT_FILE || !process.env.RECOVERY_KEY_FILE) throw Error("Set EXPORT_FILE and RECOVERY_KEY_FILE.");
    const file=await open(process.env.EXPORT_FILE,"r");
    try { await stageEncryptedBackup(runtime.env,Readable.toWeb(file.createReadStream()),(await readFile(process.env.RECOVERY_KEY_FILE,"utf8")).trim()); }
    finally {await file.close();}
    await recoverBackup(runtime.env);
  }
  if(command === "recover-owner") {
    if(!process.env.OWNER_PASSWORD || !process.env.RECOVERY_KEY_FILE) throw Error("Set OWNER_PASSWORD and a new private RECOVERY_KEY_FILE.");
    const recoveryCode=crypto.randomUUID()+crypto.randomUUID();
    // Write the recovery credential before changing access, never print it.
    await writeFile(process.env.RECOVERY_KEY_FILE,recoveryCode,{mode:0o600,flag:"wx"});
    const state = await runtime.env.DB.prepare("SELECT maintenance FROM schema_version WHERE id=1").first();
    const result=(await runtime.env.DB.batch([
      runtime.env.DB.prepare("UPDATE schema_version SET maintenance=0 WHERE id=1"),
      runtime.env.DB.prepare("UPDATE users SET password_hash=?,recovery_hash=?,auth_version=auth_version+1 WHERE role='owner' RETURNING id").bind(await hashPassword(process.env.OWNER_PASSWORD),await sha256(recoveryCode)),
      runtime.env.DB.prepare("UPDATE schema_version SET maintenance=? WHERE id=1").bind(state.maintenance),
    ]))[1];
    if(result.results.length !== 1) throw Error("Recovery requires exactly one owner.");
  }
  console.log(`${command}: completed`);
} finally {await runtime.close();}
