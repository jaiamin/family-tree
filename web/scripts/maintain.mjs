import { readFile, writeFile, open } from "node:fs/promises";
import { Readable } from "node:stream";
import { localRuntime } from "./server.mjs";
import { refreshBackup, preUpgradeBackup } from "../dist/maintenance/backup.js";
import { recoverBackup } from "../dist/maintenance/recovery.js";
import { encryptedBackup, stageEncryptedBackup } from "../dist/maintenance/backup-export.js";
import { hashPassword } from "../dist/maintenance/password.js";
import { sha256 } from "../dist/maintenance/auth.js";

const command = process.argv[2];
if (!["init","backup","preflight","export","restore","recover-owner"].includes(command)) throw Error("Commands: init, backup, preflight, export, restore, recover-owner. Configure DATA_DIR, BACKUP_DIR and PUBLIC_ORIGIN through the environment.");
const runtime = await localRuntime({directory:process.env.DATA_DIR || "/data",backupDirectory:process.env.BACKUP_DIR,
  origin:process.env.PUBLIC_ORIGIN,basePath:process.env.BASE_PATH ?? "/family-tree",initialize:command === "init"});
try {
  if (command === "backup") {
    await refreshBackup(runtime.env);
    const state=await runtime.env.DB.prepare("SELECT error FROM backup_state WHERE id=1").first();
    if(state.error) throw Error(state.error);
  }
  if (command === "preflight") await preUpgradeBackup(runtime.env);
  if (command === "export") {
    if(!process.env.EXPORT_FILE || !process.env.RECOVERY_KEY_FILE) throw Error("Set EXPORT_FILE and RECOVERY_KEY_FILE to separate private destinations.");
    const key=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
    await writeFile(process.env.RECOVERY_KEY_FILE,key,{mode:0o600,flag:"wx"});
    const file=await open(process.env.EXPORT_FILE,"wx",0o600);
    try { for await(const chunk of await encryptedBackup(runtime.env,key)) await file.write(chunk); await file.sync(); }
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
    const result=await runtime.env.DB.prepare("UPDATE users SET password_hash=?,recovery_hash=?,auth_version=auth_version+1 WHERE role='owner' RETURNING id")
      .bind(await hashPassword(process.env.OWNER_PASSWORD),await sha256(recoveryCode)).all();
    if(result.results.length !== 1) throw Error("Recovery requires exactly one owner.");
  }
  console.log(`${command}: completed`);
} finally {await runtime.close();}
