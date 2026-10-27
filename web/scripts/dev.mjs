import { runtime } from "./runtime.mjs";
const basePath = process.env.BASE_PATH ?? "/family-tree", port = Number(process.env.PORT || 8000);
const mf = await runtime({ bindings: { BASE_PATH: basePath, GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "", OWNER_EMAIL: process.env.OWNER_EMAIL || "owner@example.com" }, host: "0.0.0.0", port, d1Persist: `${process.env.DEV_DATA_DIR || ".local/shared-preview"}/d1`, r2Persist: `${process.env.DEV_DATA_DIR || ".local/shared-preview"}/r2` });
await mf.ready;
console.log(`Development preview: http://localhost:${port}${basePath}/ (password: local-preview-only; synthetic development only)`);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { await mf.dispose(); process.exit(0); });
