import { runtime } from "./runtime.mjs";
const basePath = process.env.BASE_PATH ?? "/family-tree", port = Number(process.env.PORT || 8000);
const mf = await runtime({ bindings: { BASE_PATH: basePath }, host: "0.0.0.0", port, d1Persist: `${process.env.DEV_DATA_DIR || ".local/private"}/d1`, r2Persist: `${process.env.DEV_DATA_DIR || ".local/private"}/r2` });
await mf.ready;
console.log(`Development preview: http://localhost:${port}${basePath}/ (setup credential: local-setup-only; synthetic development only)`);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { await mf.dispose(); process.exit(0); });
