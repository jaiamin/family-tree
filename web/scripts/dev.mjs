import { runtime } from "./runtime.mjs";
import { readFile } from "node:fs/promises";
const mf = await runtime({ host: "0.0.0.0", port: Number(process.env.PORT || 8000), d1Persist: ".local/d1", r2Persist: ".local/r2" });
await mf.ready;
if (process.env.FAMILY_PREVIEW_COLLECTION) {
  const collection = JSON.parse(await readFile(process.env.FAMILY_PREVIEW_COLLECTION, "utf8"));
  if (collection.site) collection.site = { name: collection.site.name, url: collection.site.url || "" };
  const current = await (await mf.dispatchFetch("http://localhost/family-tree/api/collection", { headers: { authorization: "Bearer local-test-owner-token" } })).json();
  if (!Object.keys(current.collection.people).length) {
    const response = await mf.dispatchFetch("http://localhost/family-tree/api/collection", { method: "PUT", headers: { authorization: "Bearer local-test-owner-token", "content-type": "application/json" }, body: JSON.stringify({ collection, revision: current.revision }) });
    if (!response.ok) throw new Error(await response.text());
  }
}
console.log("Local family website: http://localhost:8000/family-tree/ (development password: local-preview-only)");
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { await mf.dispose(); process.exit(0); });
