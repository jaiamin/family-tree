import { runtime as createRuntime } from "../scripts/runtime.mjs";
import { createHash } from "node:crypto";

// Fixtures are opt-in test infrastructure, never part of production or dev setup.
export async function runtime(options = {}) {
  const mf = await createRuntime({ ...options, bindings: { GOOGLE_CLIENT_ID: "test-google-client", ...options.bindings } });
  const db = await mf.getD1Database("DB");
  for (const role of ["owner", "editor"]) {
    await db.prepare("INSERT INTO users(id,name,email,role) VALUES(?,?,?,?)")
      .bind(`${role}-fixture`, `Test ${role}`, `${role}@example.com`, role).run();
  }
  await db.prepare("INSERT INTO automation_credentials(id,name,token_hash,user_id) VALUES('fixture','Tests',?,'owner-fixture')")
    .bind(createHash("sha256").update("local-test-owner-token").digest("hex")).run();
  await db.prepare("INSERT INTO identities(provider,subject,user_id) VALUES('google','editor@example.com','editor-fixture')").run();
  return mf;
}
