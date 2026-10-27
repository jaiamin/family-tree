import { createServer } from "node:http";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { mkdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { validatePublicSettings } from "./config.mjs";
import { clientAddress, proxyHops } from "./proxy.mjs";
import app from "../dist/app.mjs";
import { LocalDatabase, LocalBlobs } from "../dist/local.mjs";

export async function assertBuiltPath(basePath) {
  const built = JSON.parse(await readFile(new URL("../dist/build.json", import.meta.url), "utf8"));
  if (basePath !== built.basePath) throw Error("BASE_PATH differs from the built frontend. Rebuild with the same BASE_PATH.");
}

export async function localRuntime({ directory, backupDirectory, origin, basePath = "/family-tree", setupToken, googleClientId = "", initialize = false }) {
  directory = resolve(directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const DB = new LocalDatabase(join(directory, "family.sqlite"));
  if (initialize) {
    if (DB.database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get()) throw Error("Installation is already initialized.");
    DB.database.exec(await readFile(new URL("../schema.sql", import.meta.url), "utf8"));
  }
  const env = { DB, PHOTOS: new LocalBlobs(join(directory, "photos")), BACKUP: new LocalBlobs(backupDirectory || join(directory, "backup")),
    BASE_PATH: basePath, PUBLIC_ORIGIN: origin, SITE_NAME: "Family Tree", SETUP_TOKEN: setupToken, GOOGLE_CLIENT_ID: googleClientId };
  const pending = new Set();
  const ctx = { waitUntil(promise) { pending.add(promise); promise.finally(() => pending.delete(promise)).catch(() => {}); } };
  return { env, fetch: (request, address = "local") => app.fetch(request, { ...env, CLIENT_IP: address }, ctx),
    async close() { await Promise.allSettled([...pending]); DB.close(); },
    async backup() { await app.backup(env, ctx); await Promise.allSettled([...pending]); } };
}
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const origin = process.env.PUBLIC_ORIGIN;
  validatePublicSettings({ publicOrigin: origin, basePath: process.env.BASE_PATH ?? "/family-tree" });
  await assertBuiltPath(process.env.BASE_PATH ?? "/family-tree");
  const hops = proxyHops(process.env.TRUST_PROXY_HOPS);
  const runtime = await localRuntime({ directory: process.env.DATA_DIR || "/data", backupDirectory: process.env.BACKUP_DIR,
    origin, basePath: process.env.BASE_PATH ?? "/family-tree", setupToken: process.env.SETUP_TOKEN, googleClientId: process.env.GOOGLE_CLIENT_ID });
  const server = createServer(async (req, res) => {
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      // The public origin is configured, never inferred from forwarded headers.
      headers.delete("cf-connecting-ip");

      const body = ["GET", "HEAD"].includes(req.method) ? undefined : req;
      const request = new Request(new URL(req.url, origin), { method: req.method, headers, body, ...body ? { duplex: "half" } : {} });
      const response = await runtime.fetch(request, clientAddress(req.socket.remoteAddress, req.headers["x-forwarded-for"], hops));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) await pipeline(Readable.fromWeb(response.body), res);
      else res.end();
    } catch {
      if (!res.headersSent) res.writeHead(500);
      if (!res.destroyed) res.end("Request failed.");
    }
  });
  server.listen(Number(process.env.PORT || 8000), "0.0.0.0");
  const interval = setInterval(() => runtime.backup().catch(() => {}), 15 * 60 * 1000);
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { clearInterval(interval); server.close(async () => { await runtime.close(); process.exit(0); }); });
}
