import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { runtime } from "./support.mjs";
import { localRuntime } from "../scripts/server.mjs";

const origin = "https://family.test", password = "synthetic-password";

for (const platform of ["worker", "local"]) {
  test(`${platform}: password login accepts browser origin fallbacks and rejects untrusted requests`, async () => {
    const directory = platform === "local" ? await mkdtemp(new URL("../.login-test-", import.meta.url).pathname) : null;
    const app = platform === "worker"
      ? await runtime({ bindings: { PUBLIC_ORIGIN: origin, FAMILY_PASSWORD: password } })
      : await localRuntime({ directory, origin, familyPassword: password, initialize: true });
    const send = (headers, suppliedPassword = password) => {
      const url = `${origin}/family-tree/api/login`;
      const options = { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ password: suppliedPassword }) };
      return platform === "worker" ? app.dispatchFetch(url, options) : app.fetch(new Request(url, options));
    };
    try {
      for (const headers of [
        { origin },
        { referer: `${origin}/family-tree` },
        { referer: `${origin}/family-tree/t/abc`, "sec-fetch-site": "same-origin" },
        { "sec-fetch-site": "same-origin" },
        { origin: "null", "sec-fetch-site": "same-origin" },
      ]) {
        const response = await send(headers);
        assert.equal(response.status, 200, `${JSON.stringify(headers)}: ${await response.text()}`);
        assert.match(response.headers.get("set-cookie"), /family_viewer=.*HttpOnly; SameSite=Lax/);
      }
      for (const headers of [
        {},
        { origin: "null" },
        { origin: "https://other.test", referer: `${origin}/family-tree`, "sec-fetch-site": "same-origin" },
        { referer: "https://other.test/family-tree" },
        { referer: "https://family.test.other.test/family-tree" },
        { referer: "invalid" },
        { referer: `${origin}/family-tree`, "sec-fetch-site": "cross-site" },
        { referer: `${origin}/family-tree`, "sec-fetch-site": "same-site" },
        { origin: "null", referer: `${origin}/family-tree` },
      ]) {
        const response = await send(headers);
        assert.equal(response.status, 403, JSON.stringify(headers));
        assert.equal((await response.json()).error, "This request must come from the family website.");
        assert.equal(response.headers.get("set-cookie"), null);
      }
      const wrong = await send({ referer: `${origin}/family-tree` }, "wrong");
      assert.equal(wrong.status, 403);
      assert.equal((await wrong.json()).error, "The password isn't right.");
    } finally {
      if (platform === "worker") await app.dispose();
      else await app.close();
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  });
}
