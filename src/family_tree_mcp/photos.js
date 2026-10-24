// Photos for the shared family tree: a Cloudflare Pages Function, published as
// functions/api/photos/[[path]].js next to the page and backed by the PHOTOS Workers KV namespace.
//
//   GET    /api/photos       {person id: version} for everyone with a photo
//   GET    /api/photos/<id>  the photo
//   POST   /api/photos       checks the family code (204, or 403)
//   PUT    /api/photos/<id>  sets the photo (body: JPEG, PNG or WebP)
//   DELETE /api/photos/<id>  removes it
//
// Changes need the family code in the X-Edit-Code header; only its SHA-256 is deployed, as the
// EDIT_CODE_HASH variable. Each photo lives at photo:<id>, and the index key lists them so a page
// view costs one read (KV's free tier allows few list calls).

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 512 * 1024;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function allowed(request, env) {
  const code = (request.headers.get("x-edit-code") || "").trim().toLowerCase();
  return Boolean(code && env.EDIT_CODE_HASH) && (await sha256(code)) === env.EDIT_CODE_HASH;
}

const index = async (env) => (await env.PHOTOS.get("index", "json")) || {};

export async function onRequest({ request, env, params }) {
  const parts = [].concat(params.path || []);
  const id = parts[0];
  if (parts.length > 1 || (id !== undefined && !ID.test(id))) return json({ error: "Not found" }, 404);
  if (!env.PHOTOS) return json({ error: "Photos are not set up for this site." }, 503);
  const method = request.method;

  if (method === "GET" && !id) return json(await index(env));
  if (method === "GET") {
    const { value, metadata } = await env.PHOTOS.getWithMetadata(`photo:${id}`, "arrayBuffer");
    if (!value) return json({ error: "Not found" }, 404);
    // The page asks for ?v=<version>, so a changed photo has a new address and can be cached.
    const cache = new URL(request.url).searchParams.has("v") ? "public, max-age=31536000, immutable" : "no-cache";
    return new Response(value, { headers: { "content-type": metadata?.type || "image/jpeg", "cache-control": cache } });
  }
  if (!["POST", "PUT", "DELETE"].includes(method) || (method === "POST") === Boolean(id)) {
    return json({ error: "Not allowed" }, 405);
  }
  if (!(await allowed(request, env))) return json({ error: "That family code isn't right." }, 403);
  if (method === "POST") return new Response(null, { status: 204 });

  const photos = await index(env);
  if (method === "DELETE") {
    await env.PHOTOS.delete(`photo:${id}`);
    delete photos[id];
    await env.PHOTOS.put("index", JSON.stringify(photos));
    return json({ ok: true });
  }
  const type = (request.headers.get("content-type") || "").split(";")[0].trim();
  if (!TYPES.includes(type)) return json({ error: "Choose a JPEG, PNG or WebP image." }, 415);
  const body = await request.arrayBuffer();
  if (!body.byteLength || body.byteLength > MAX_BYTES) return json({ error: "That photo is too large." }, 413);
  const v = Date.now();
  await env.PHOTOS.put(`photo:${id}`, body, { metadata: { v, type } });
  photos[id] = v;
  await env.PHOTOS.put("index", JSON.stringify(photos));
  return json({ v });
}
