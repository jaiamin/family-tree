// Synthetic browser-test installation; never imported by development or production.
import { runtime } from "../../scripts/runtime.mjs";
import { createHash } from "node:crypto";
const mf = await runtime({ bindings:{BASE_PATH:process.env.BASE_PATH ?? "/family-tree",GOOGLE_CLIENT_ID:"browser-test-client"},host:"0.0.0.0",port:8002 });
const db = await mf.getD1Database("DB");
await db.prepare("INSERT INTO users(id,email,name,role) VALUES('browser-owner','owner@example.com','Family owner','owner')").run();
await db.prepare("INSERT INTO sessions(token_hash,user_id,auth_version,expires) VALUES(?,'browser-owner',1,?)")
  .bind(createHash("sha256").update("synthetic-browser-owner").digest("hex"),Math.floor(Date.now()/1000)+3600).run();
await mf.ready;
for (const signal of ["SIGINT","SIGTERM"]) process.on(signal,async()=>{await mf.dispose();process.exit(0);});
