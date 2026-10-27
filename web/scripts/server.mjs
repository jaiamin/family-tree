import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import app from "../dist/worker.mjs";
import { LocalDatabase, LocalBlobs } from "../dist/local.mjs";

export async function localRuntime({ directory, backupDirectory, origin, basePath = "/family-tree", setupToken, initialize = false }) {
  directory = resolve(directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const DB = new LocalDatabase(join(directory, "family.sqlite"));
  if (initialize) {
    if (DB.database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_version'").get()) throw Error("Installation is already initialized.");
    DB.database.exec(await readFile(new URL("../schema.sql", import.meta.url), "utf8"));
  }
  const env = { DB, PHOTOS: new LocalBlobs(join(directory, "photos")), BACKUP: new LocalBlobs(backupDirectory || join(directory, "backup")),
    BASE_PATH: basePath, PUBLIC_ORIGIN: origin, SITE_NAME: "Family Tree", SETUP_TOKEN: setupToken };
  const pending = new Set();
  const ctx = { waitUntil(promise) { pending.add(promise); promise.finally(() => pending.delete(promise)).catch(() => {}); } };
  return { env, fetch: (request, address = "local") => app.fetch(request, { ...env, CLIENT_IP: address }, ctx),
    async close() { await Promise.allSettled([...pending]); DB.close(); },
    async backup() { await app.scheduled({}, env, ctx); await Promise.allSettled([...pending]); } };
}
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const origin = process.env.PUBLIC_ORIGIN;
  if (!origin || !origin.startsWith("https://")) throw Error("PUBLIC_ORIGIN must be your configured HTTPS origin.");
  const runtime = await localRuntime({ directory: process.env.DATA_DIR || "/data", backupDirectory: process.env.BACKUP_DIR,
    origin, basePath: process.env.BASE_PATH ?? "/family-tree", setupToken: process.env.SETUP_TOKEN });
  const server = createServer(async (req, res) => {
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      // The public origin is configured, never inferred from forwarded headers.
      headers.delete("cf-connecting-ip");

      const body = ["GET", "HEAD"].includes(req.method) ? undefined : req;
      const request = new Request(new URL(req.url, origin), { method: req.method, headers, body, ...body ? { duplex: "half" } : {} });
      const response = await runtime.fetch(request, req.socket.remoteAddress || "unknown");
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) for await (const chunk of response.body) res.write(chunk);
      res.end();
    } catch { res.writeHead(500); res.end("Request failed."); }
  });
  server.listen(Number(process.env.PORT || 8000), "0.0.0.0");
  const interval = setInterval(() => runtime.backup().catch(() => {}), 15 * 60 * 1000);
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { clearInterval(interval); server.close(async () => { await runtime.close(); process.exit(0); }); });
}
