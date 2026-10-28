import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { checkDeployment } from "../scripts/smoke.mjs";

for (const base of ["", "/family-tree", "/our/family"]) {
  test(`deployment smoke verifies routing and privacy at ${base || "/"}`, async t => {
    let fault = "";
    const server = createServer((request, response) => {
      assert.equal(request.method, "GET");
      assert.equal(request.headers.authorization, undefined);
      assert.equal(request.headers.cookie, undefined);
      const path = request.url.slice(base.length);
      if (path === "" || path === "/") {
        response.setHeader("content-type", "text/html");
        response.end(fault === "page" ? "Portfolio not found" : `<form id="family-login"></form><script src="${base}/assets/app.js"></script>`);
      } else if (path === "/api/session") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ authenticated: fault === "session" }));
      } else if (path === "/api/view") {
        response.writeHead(fault === "privacy" ? 200 : 401, { "cache-control": fault === "cache" ? "public" : "no-store" });
        response.end("{}");
      } else if (path === "/assets/app.js") {
        response.writeHead(fault === "asset" ? 404 : 200, { "content-type": "application/javascript" });
        response.end("// app");
      } else { response.writeHead(404); response.end(); }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const address = `http://127.0.0.1:${server.address().port}${base}`;
    await checkDeployment(address);
    for (const [failure, message] of [
      ["page", /password form/], ["session", /unauthenticated/], ["privacy", /require authentication/],
      ["cache", /must not be cached/], ["asset", /script must be available/],
    ]) {
      fault = failure;
      await assert.rejects(checkDeployment(address), message);
    }
  });
}

test("deployment smoke rejects credential-bearing or insecure remote URLs", async () => {
  for (const url of ["https://user:password@example.com", "https://example.com?token=x", "https://example.com#x", "http://example.com"]) {
    await assert.rejects(checkDeployment(url));
  }
});
