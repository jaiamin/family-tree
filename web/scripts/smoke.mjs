import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import { installationConfig } from "./config.mjs";

// Read-only checks: no family password, account, token, or records are needed.
export async function checkDeployment(address) {
  const base = new URL(address);
  assert(!base.username && !base.password && !base.search && !base.hash, "Use an app URL without credentials, query, or fragment.");
  assert(base.protocol === "https:" || (base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname)), "Use HTTPS, or HTTP on localhost.");
  const path = base.pathname.replace(/\/$/, "");
  const get = path => fetch(new URL(path, base.origin), {
    redirect: "error", signal: AbortSignal.timeout(10000), headers: { "User-Agent": "family-tree-smoke" },
  });
  const [page, session, records] = await Promise.all([get(path || "/"), get(`${path}/api/session`), get(`${path}/api/view`)]);
  assert.equal(page.status, 200, "Password page must be available.");
  const html = await page.text();
  assert.match(html, /id="family-login"/, "Expected the family password form.");
  assert.equal(session.status, 200, "Session endpoint must be available.");
  assert.equal((await session.json()).authenticated, false, "Anonymous requests must stay unauthenticated.");
  assert.equal(records.status, 401, "Family records must require authentication.");
  assert.match(records.headers.get("cache-control") || "", /no-store/, "Private responses must not be cached.");
  await records.body?.cancel();
  const script = html.match(/<script[^>]*src="([^"]+)"/i)?.[1];
  assert(script?.startsWith(`${path}/assets/`), "Expected a bundled application script under the base path.");
  const asset = await get(script);
  assert.equal(asset.status, 200, "Application script must be available.");
  assert.match(asset.headers.get("content-type") || "", /javascript/, "Application script must be JavaScript.");
  await asset.body?.cancel();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = process.argv[2] ? null : installationConfig();
    const address = process.argv[2] || `${config.publicOrigin}${config.basePath}`;
    for (let attempt = 1; ; attempt++) {
      try { await checkDeployment(address); break; }
      catch (error) {
        if (attempt === 5) throw error;
        console.error(`Deployment not ready; retrying (${attempt}/5).`);
        await setTimeout(3000);
      }
    }
    console.log("Deployment: password page, API privacy and application asset passed.");
  } catch (error) {
    console.error(`Deployment check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
