// Operator-only REST client. The serving Worker uses native bindings instead.
// Consume an existing, resource-scoped credential through the environment.
export function cloudflareStorage(config, credential = process.env.CLOUDFLARE_API_TOKEN, transport = fetch) {
  if (!credential) throw Error("Set CLOUDFLARE_API_TOKEN through your operator environment.");
  const root = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}`;
  const headers = { authorization: `Bearer ${credential}` };
  async function query(body) {
    const response = await transport(`${root}/d1/database/${encodeURIComponent(config.databaseId)}/query`, {
      method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok || !result.success || result.result.some(row => !row.success)) throw Error(`D1 maintenance request failed (${response.status}).`);
    return result.result;
  }
  const prepare = (sql, params = []) => ({ sql, params,
    bind: (...values) => prepare(sql, values),
    all: async () => (await query({ sql, params }))[0],
    run: async () => (await query({ sql, params }))[0],
    first: async () => (await query({ sql, params }))[0].results[0] || null,
  });
  const DB = { prepare, batch: statements => query({ batch: statements.map(({ sql, params }) => ({ sql, params })) }), execute: sql => query({ sql }) };
  function bucket(name) {
    const url = `${root}/r2/buckets/${encodeURIComponent(name)}/objects`;
    const keyPath = key => key.split("/").map(encodeURIComponent).join("/");
    return {
      async get(key) {
        const response = await transport(`${url}/${keyPath(key)}`, { headers });
        if (response.status === 404) return null;
        if (!response.ok) throw Error(`R2 read failed (${response.status}).`);
        const bytes = await response.arrayBuffer();
        return { key, size: bytes.byteLength, etag: response.headers.get("etag")?.replaceAll('"', '') || "",
          httpMetadata: { contentType: response.headers.get("content-type") || undefined },
          body: new Response(bytes).body, arrayBuffer: async () => bytes, json: async () => JSON.parse(new TextDecoder().decode(bytes)) };
      },
      async head(key) { return this.get(key); },
      async put(key, value, options = {}) {
        if (options.onlyIf) throw Error("Conditional writes require Worker bindings; maintenance must run with application writes stopped.");
        const response = await transport(`${url}/${keyPath(key)}`, { method: "PUT", headers: { ...headers, "content-type": options.httpMetadata?.contentType || "application/octet-stream" }, body: value });
        const result = await response.json();
        if (!response.ok || !result.success) throw Error(`R2 write failed (${response.status}).`);
        return result.result;
      },
      async list({prefix = "", cursor} = {}) {
        const params = new URLSearchParams({prefix}); if (cursor) params.set("cursor", cursor);
        const response = await transport(`${url}?${params}`, {headers}); const result = await response.json();
        if (!response.ok || !result.success) throw Error(`R2 listing failed (${response.status}).`);
        return { objects: result.result, truncated: Boolean(result.result_info?.is_truncated), cursor: result.result_info?.cursor };
      },
      async delete() { throw Error("Remote deletion is intentionally unavailable to maintenance tools."); },
    };
  }
  return { DB, PHOTOS: bucket(config.photosBucket), BACKUP: bucket(config.backupBucket),
    BASE_PATH: config.basePath, SITE_NAME: config.siteName, PUBLIC_ORIGIN: config.publicOrigin };
}
