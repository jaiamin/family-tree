import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, writeFile, rename, readdir, unlink, open } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { BlobInfo, BlobStore, QueryResult, SqlStore, Statement, StoredBlob } from "./storage";

export class LocalDatabase implements SqlStore {
  readonly database: DatabaseSync;
  constructor(path: string) {
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  }
  prepare(sql: string): Statement {
    return new LocalStatement(this, sql);
  }
  async batch<T>(statements: Statement[]): Promise<QueryResult<T>[]> {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      // Execute synchronously: no unrelated request can interleave a transaction.
      const results = statements.map(statement => (statement as LocalStatement).execute<T>());
      this.database.exec("COMMIT");
      return results;
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
  close() { this.database.close(); }
}
class LocalStatement implements Statement {
  constructor(private store: LocalDatabase, private sql: string, private values: unknown[] = []) {}
  bind(...values: unknown[]) { return new LocalStatement(this.store, this.sql, values); }
  execute<T = Record<string, unknown>>(): QueryResult<T> {
    const statement = this.store.database.prepare(this.sql);
    const values = this.values as (string | number | null | Uint8Array)[];
    const results = statement.columns().length ? statement.all(...values) : [];
    const changes = statement.columns().length ? Number(this.store.database.prepare("SELECT changes() AS n").get()!.n) : Number(statement.run(...values).changes);
    return { results: results as T[], meta: { changes } };
  }
  async first<T>() { return this.execute<T>().results[0] || null; }
  async all<T>() { return this.execute<T>(); }
  async run() { return this.execute(); }
}

// Each atomically published object has a small JSON header and raw bytes. Head
// and list read only headers, so retained image history does not inflate scans.
export class LocalBlobs implements BlobStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string) { this.directory = resolve(directory); }
  private path(key: string) { return join(this.directory, `${createHash("sha256").update(key).digest("hex")}.object`); }
  private async info(path: string): Promise<BlobInfo | null> {
    let file;
    try { file = await open(path,"r"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    try {
      const header = Buffer.alloc(1024);
      const {bytesRead} = await file.read(header,0,header.length,0);
      const newline = header.subarray(0,bytesRead).indexOf(10);
      if (newline < 0) throw Error("Invalid private object header.");
      return JSON.parse(header.toString("utf8",0,newline));
    } finally { await file.close(); }
  }
  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => {});
    return next;
  }
  async get(key: string): Promise<StoredBlob | null> {
    let object: Buffer;
    try { object = await readFile(this.path(key)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    const newline = object.indexOf(10);
    if (newline < 0) throw Error("Invalid private object header.");
    const info: BlobInfo = JSON.parse(object.toString("utf8",0,newline));
    const bytes = Uint8Array.from(object.subarray(newline+1));
    if (bytes.byteLength !== info.size) throw Error("Incomplete private object.");
    return { ...info, body: new Response(bytes).body!, arrayBuffer: async () => bytes.buffer,
      json: async <T>() => JSON.parse(new TextDecoder().decode(bytes)) as T };
  }
  head(key: string) { return this.info(this.path(key)); }
  put(key: string, value: string | ArrayBuffer | ArrayBufferView, options: Parameters<BlobStore["put"]>[2] = {}) {
    return this.serialized(async () => {
      const existing = await this.head(key);
      if (options.onlyIf?.etagMatches && existing?.etag !== options.onlyIf.etagMatches) return null;
      if (options.onlyIf?.etagDoesNotMatch === "*" && existing) return null;
      const bytes = typeof value === "string" ? Buffer.from(value) : value instanceof ArrayBuffer ? Buffer.from(value) : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      const info: BlobInfo = { key, etag: createHash("sha256").update(bytes).digest("hex"), size: bytes.length,
        httpMetadata: options.httpMetadata, customMetadata: options.customMetadata };
      const header = Buffer.from(JSON.stringify(info)+"\n");
      if (header.byteLength > 1024) throw Error("Private object metadata is too large.");
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const target = this.path(key), temporary = `${target}.${randomUUID()}.tmp`;
      await writeFile(temporary, Buffer.concat([header,bytes]), { mode: 0o600, flush: true });
      await rename(temporary, target);
      const directory = await open(this.directory,"r");
      try { await directory.sync(); } finally { await directory.close(); }
      return info;
    });
  }
  async list(options: { prefix?: string; cursor?: string } = {}) {
    let files: string[];
    try { files = await readdir(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { objects: [], truncated: false }; throw error; }
    const objects: BlobInfo[] = [];
    for (const file of files.filter(file => file.endsWith(".object"))) {
      const info = await this.info(join(this.directory,file));
      if (info?.key.startsWith(options.prefix || "")) objects.push(info);
    }
    return { objects: objects.sort((a, b) => a.key.localeCompare(b.key)), truncated: false };
  }
  delete(key: string) {
    return this.serialized(async () => {
      if (key.startsWith("people/")) throw Error("Immutable uploads cannot be deleted.");
      try { await unlink(this.path(key)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    });
  }
}
