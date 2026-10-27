import { runtime as createRuntime } from "../scripts/runtime.mjs";
import { pbkdf2Sync, createHash } from "node:crypto";

// Fixtures are opt-in test infrastructure, never part of production or dev setup.
const salt = Buffer.alloc(16, 1);
const password = `pbkdf2-sha256$600000$${salt.toString("hex")}$${pbkdf2Sync("local-preview-only", salt, 600000, 32, "sha256").toString("hex")}`;
export async function runtime(options = {}) {
  const mf = await createRuntime({ ...options, bindings: { GOOGLE_CLIENT_ID: "test-google-client", ...options.bindings } });
  const db = await mf.getD1Database("DB");
  for (const role of ["owner", "viewer", "editor"]) {
    await db.prepare("INSERT INTO users(id,username,name,email,role,password_hash) VALUES(?,?,?,?,?,?)")
      .bind(`${role}-fixture`, role, `Test ${role}`, `${role}@example.com`, role, password).run();
  }
  await db.prepare("INSERT INTO automation_credentials(id,name,token_hash,user_id) VALUES('fixture','Tests',?,'owner-fixture')")
    .bind(createHash("sha256").update("local-test-owner-token").digest("hex")).run();
  await db.prepare("INSERT INTO identities(provider,subject,user_id) VALUES('google','editor@example.com','editor-fixture')").run();
  return mf;
}
