import { runtime } from "./runtime.mjs";
const mf = await runtime({ host: "0.0.0.0", port: Number(process.env.PORT || 8000), d1Persist: ".local/v2/d1", r2Persist: ".local/v2/r2" });
await mf.ready;
console.log("Development preview: http://localhost:8000/family-tree/ (setup credential: local-setup-only; synthetic development only)");
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { await mf.dispose(); process.exit(0); });
