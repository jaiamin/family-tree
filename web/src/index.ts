import { applyLink, applyPersonEdit, assert, HttpError, uuid, record } from "./model";
import { googleChallenge, googleLogin, identity, newSession, rateLimit, requireRole, requireSameOrigin, sessionCookie, sha256, secretMatches } from "./auth";
import { readCollection, readView, saveCollection, treeView } from "./data";
import type { Env } from "./types";
import pages from "../generated/pages.json";
import { refreshBackup } from "./backup";
import { gedcom } from "./gedcom";
function asset(path: string, immutable = false) {
  const value = (pages as Record<string, string>)[path];
  assert(value, "Not found.", 404);
  const type = path.endsWith(".js") ? "text/javascript" : path.endsWith(".svg") ? "image/svg+xml" : "text/html";
  return new Response(value, { headers: { "content-type": `${type}; charset=utf-8`, ...immutable ? { "cache-control": "public, max-age=31536000, immutable" } : {} } });
}

const json = (body: unknown, status = 200, headers: HeadersInit = {}) => Response.json(body, { status, headers });
async function limitedBody(request: Request, max = 1_500_000) {
  assert(request.body, "Request body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); throw new HttpError(413, "This upload is too large."); }
    chunks.push(value);
  }
  const data = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return data;
}
async function bodyOf(request: Request) {
  assert(request.headers.get("content-type")?.includes("application/json"), "Send JSON.", 415);
  try {
    const body = JSON.parse(new TextDecoder().decode(await limitedBody(request)));
    assert(record(body), "Send a JSON object.");
    return body;
  }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, "Invalid JSON."); }
}
function text(value: unknown, max: number, required = false): string {
  assert(typeof value === "string" && value.trim().length <= max && (!required || value.trim().length > 0), "Please complete the form within the stated limits.");
  return value.trim();
}
async function photo(request: Request, env: Env, path: string) {
  const id = path.split("/")[3];
  if (path === "/api/photos" && request.method === "GET") {
    const { results } = await env.DB.prepare("SELECT person_id, version FROM photos").all<{ person_id: string; version: string }>();
    return json(Object.fromEntries(results.map(p => [p.person_id, p.version])));
  }
  assert(uuid(id) && path === `/api/photos/${id}`, "Not found.", 404);
  if (request.method === "GET") {
    const head = await env.DB.prepare("SELECT p.object_key, p.version FROM photos p JOIN people ON people.id = p.person_id WHERE p.person_id = ?").bind(id).first<{ object_key: string; version: string }>();
    assert(head, "Photo not found.", 404);
    const etag = `"${head.version}"`;
    const headers = { "cache-control": "private, no-cache", etag, vary: "Cookie, Authorization" };
    const matches = request.headers.get("if-none-match")?.split(",").some(value => value.trim().replace(/^W\//, "") === etag || value.trim() === "*");
    if (matches) return new Response(null, { status: 304, headers });
    const object = await env.PHOTOS.get(head.object_key);
    assert(object, "Photo not found.", 404);
    return new Response(object.body, { headers: { ...headers, "content-type": object.httpMetadata?.contentType || "image/jpeg" } });
  }
  assert(await env.DB.prepare("SELECT id FROM people WHERE id = ?").bind(id).first(), "Person not found.", 404);
  if (request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM photos WHERE person_id = ?").bind(id).run();
    return json({ ok: true });
  }
  assert(request.method === "PUT", "Method not allowed.", 405);
  await rateLimit(request, env, "photos", 30, 3600);
  const bytes = await limitedBody(request, 512 * 1024);
  const type = request.headers.get("content-type");
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v);
  const webp = new TextDecoder().decode(bytes.slice(0,4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8,12)) === "WEBP";
  assert((type === "image/jpeg" && jpeg) || (type === "image/png" && png) || (type === "image/webp" && webp), "Choose a JPEG, PNG, or WebP photo.", 415);
  const version = crypto.randomUUID(), key = `people/${id}/${version}`;
  await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: type! } });
  // Immutable uploads are retained. Never delete a relative's contribution on replacement.
  await env.BACKUP.put(key, bytes, { httpMetadata: { contentType: type! } });
  await env.DB.batch([
    env.DB.prepare("INSERT INTO photo_uploads(id, person_id, object_key, content_type) VALUES (?, ?, ?, ?)").bind(version, id, key, type),
    env.DB.prepare("INSERT INTO photos(person_id, object_key, version) VALUES (?, ?, ?) ON CONFLICT(person_id) DO UPDATE SET object_key = excluded.object_key, version = excluded.version").bind(id, key, version),
  ]);
  return json({ v: version });
}
async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url), base = env.BASE_PATH || "";
  assert(!base || url.pathname === base || url.pathname.startsWith(`${base}/`), "Not found.", 404);
  const path = url.pathname.slice(base.length) || "/";
  const method = request.method;
  if (["GET", "HEAD"].includes(method) && path.startsWith("/assets/")) return asset(path, true);
  const user = await identity(request, env);
  if (!["GET", "HEAD"].includes(method)) requireSameOrigin(request, env);
  if (path === "/api/session" && method === "GET") return json({ ...(user?.role === "owner" ? { backup: await env.DB.prepare("SELECT generation, saved_generation, saved_at, error FROM backup_state WHERE id = 1").first() } : {}), authenticated: !!user, role: user?.role, email: user?.email, name: user?.name, picture: user?.picture, siteName: env.SITE_NAME, googleClientId: env.GOOGLE_CLIENT_ID || "" });
  if (path === "/api/login" && method === "POST") {
    assert(env.FAMILY_PASSWORD, "The family password hasn't been configured yet.", 503);
    await rateLimit(request, env, "password", 10, 900);
    const body = await bodyOf(request);
    assert(typeof body.password === "string" && body.password.length <= 200 && await secretMatches(body.password, env.FAMILY_PASSWORD), "That password isn't right.", 403);
    return json({ ok: true }, 200, { "set-cookie": await newSession(request, env, null) });
  }
  if (path === "/api/google/start" && method === "POST") {
    const challenge = await googleChallenge(request, env);
    return json({ nonce: challenge.nonce }, 200, { "set-cookie": challenge.cookie });
  }
  if (path === "/api/google/login" && method === "POST") {
    await rateLimit(request, env, "google-login", 20, 900);
    const body = await bodyOf(request);
    assert(typeof body.credential === "string" && body.credential.length < 20000, "Invalid Google sign-in.");
    return json({ ok: true }, 200, { "set-cookie": await googleLogin(request, env, body.credential) });
  }
  if (path === "/api/logout" && method === "POST") {
    const { cookie } = await import("./auth");
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(cookie(request, "family_session"))).run();
    if (user?.email && user.email !== "MCP") {
      return json({ ok: true }, 200, { "set-cookie": await newSession(request, env, null) });
    }
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(request, env, "family_session", "", 0) });
  }
  if (path.startsWith("/api/")) {
    requireRole(user);
    const exportRoute = /^\/api\/trees\/([0-9a-f-]+)\/gedcom$/.exec(path);
    if (exportRoute && method === "GET") {
      const { collection } = await readCollection(env);
      const tree = treeView(collection, exportRoute[1], env.SITE_NAME);
      const name = tree.name.normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "family-tree";
      return new Response(gedcom(tree), { headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${name}.ged"` } });
    }
    if (path === "/api/view" && method === "GET") {
      return json(await readView(env, url.searchParams.get("tree")));
    }
    if (path.startsWith("/api/photos")) {
      if (method === "DELETE") requireRole(user, "editor");
      return photo(request, env, path);
    }
    if (path === "/api/suggestions" && method === "POST") {
      await rateLimit(request, env, "suggestions", 10, 3600);
      const body = await bodyOf(request);
      const name = text(body.name, 100, true), message = text(body.message, 3000, true);
      const contact = body.contact ? text(body.contact, 200) : null;
      const personId = body.personId || null;
      let personName = null;
      if (personId) {
        const { collection } = await readCollection(env);
        assert(uuid(personId) && collection.people[personId], "Person not found.", 404);
        personName = collection.people[personId].name;
      }
      const id = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO suggestions(id, person_id, person_name, sender_name, contact, message) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(id, personId, personName, name, contact, message).run();
      return json({ id }, 201);
    }
    if (path === "/api/suggestions" && method === "GET") {
      requireRole(user, "editor");
      const { results } = await env.DB.prepare("SELECT suggestions.*, (SELECT tree_id FROM tree_members WHERE person_id = suggestions.person_id ORDER BY tree_id LIMIT 1) AS tree_id FROM suggestions ORDER BY created_at DESC LIMIT 200").all();
      return json(results);
    }
    if (path.startsWith("/api/suggestions/") && method === "PATCH") {
      requireRole(user, "editor");
      const body = await bodyOf(request), id = path.split("/")[3];
      assert(uuid(id) && (body.status === "open" || body.status === "done"), "Invalid suggestion status.");
      const result = await env.DB.prepare("UPDATE suggestions SET status = ? WHERE id = ?").bind(body.status, id).run();
      assert(result.meta.changes, "Suggestion not found.", 404);
      return json({ ok: true });
    }
    if (/^\/api\/suggestions\/[^/]+$/.test(path) && method === "DELETE") {
      requireRole(user, "editor");
      const id = path.split("/")[3];
      assert(uuid(id), "Invalid suggestion.");
      const result = await env.DB.prepare("DELETE FROM suggestions WHERE id = ?").bind(id).run();
      assert(result.meta.changes, "Suggestion not found.", 404);
      return json({ ok: true });
    }
    if (path === "/api/collection") {
      requireRole(user, "owner");
      if (method === "GET") return json(await readCollection(env));
      if (method === "PUT") {
        const body = await bodyOf(request);
        const revision = await saveCollection(env, body.collection, body.revision, user, "MCP or owner update");
        return json({ revision });
      }
    }
    if (path === "/api/editors") {
      requireRole(user, "owner");
      if (method === "GET") return json((await env.DB.prepare("SELECT email FROM editors ORDER BY email").all()).results);
      if (method === "POST" || method === "DELETE") {
        const body = await bodyOf(request), email = text(body.email, 254, true).toLowerCase();
        assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), "Enter a valid email address.");
        await env.DB.prepare(method === "POST" ? "INSERT OR IGNORE INTO editors(email) VALUES (?)" : "DELETE FROM editors WHERE email = ?").bind(email).run();
        return json({ ok: true });
      }
    }
    if (path === "/api/people" && method === "GET") {
      requireRole(user, "editor");
      const { collection } = await readCollection(env);
      return json(Object.values(collection.people).sort((a, b) => a.name.localeCompare(b.name)).map(p => ({
        id: p.id, name: p.name, birth_date: p.birth_date,
        parents: p.parents.map(id => collection.people[id].name),
        trees: Object.values(collection.trees).filter(tree => tree.members.includes(p.id)).map(tree => tree.name),
      })));
    }
    if (/^\/api\/people\/[^/]+$/.test(path) && method === "DELETE") {
      requireRole(user, "owner");
      const id = path.split("/")[3], body = await bodyOf(request);
      const { collection, revision } = await readCollection(env);
      assert(uuid(id) && collection.people[id], "Person not found.", 404);
      assert(body.revision === revision, "Someone else updated the tree. Reload before deleting.", 409);
      const name = collection.people[id].name;
      assert(body.name === name, "Enter the person's full name to confirm deletion.");
      delete collection.people[id];
      for (const person of Object.values(collection.people)) {
        person.parents = person.parents.filter(other => other !== id);
        person.partners = person.partners.filter(other => other !== id);
      }
      for (const key of Object.keys(collection.partnerships)) if (key.split("+").includes(id)) delete collection.partnerships[key];
      for (const tree of Object.values(collection.trees)) tree.members = tree.members.filter(other => other !== id);
      return json({ revision: await saveCollection(env, collection, revision, user, `Deleted ${name}`) });
    }
    if (path === "/api/people" && method === "POST" || /^\/api\/people\/[^/]+$/.test(path) && method === "PATCH" || path === "/api/relationships" && method === "POST") {
      requireRole(user, "editor");
      const body = await bodyOf(request), { collection, revision } = await readCollection(env);
      assert(body.revision === revision, "Someone else updated the tree. Reload before saving.", 409);
      let id = path.split("/")[3];
      if (path === "/api/relationships") {
        assert(typeof body.personId === "string" && typeof body.relativeId === "string", "Choose two people.");
        applyLink(collection, body.personId, body.relativeId, body.relation, body.remove === true, body.status);
        if (body.treeId && !body.remove) {
          assert(uuid(body.treeId) && collection.trees[body.treeId]?.members.includes(body.personId), "Choose an existing tree and person.");
          const members = collection.trees[body.treeId].members;
          if (!members.includes(body.relativeId)) members.push(body.relativeId);
        }
      } else if (method === "PATCH") applyPersonEdit(collection, id, body.fields);
      else {
        assert(uuid(body.treeId) && collection.trees[body.treeId], "Choose an existing tree.");
        assert(uuid(body.relativeId) && collection.trees[body.treeId].members.includes(body.relativeId), "Choose an existing relative in this tree.");
        id = crypto.randomUUID();
        collection.people[id] = { id, name: "", parents: [], partners: [] };
        applyPersonEdit(collection, id, body.fields);
        collection.trees[body.treeId].members.push(id);
        applyLink(collection, body.relativeId, id, body.relation, false, body.status);
      }
      if (body.otherParentId != null && body.otherParentId !== "") {
        assert(method === "POST" && body.remove !== true && body.relation === "child" && uuid(body.otherParentId), "Choose an existing other parent for this child.");
        const parentId = path === "/api/relationships" ? body.personId : body.relativeId;
        const childId = path === "/api/relationships" ? body.relativeId : id;
        assert(uuid(parentId) && uuid(childId) && uuid(body.treeId), "Choose an existing family and child.");
        assert(body.otherParentId !== parentId, "Choose a different other parent.");
        assert(collection.people[body.otherParentId], "Other parent not found.");
        applyLink(collection, childId, body.otherParentId, "parent");
        const family = collection.trees[body.treeId];
        assert(family && family.members.includes(parentId), "Choose an existing family tree.");
        if (!family.members.includes(body.otherParentId)) family.members.push(body.otherParentId);
      }
      const next = await saveCollection(env, collection, revision, user, path === "/api/relationships" ? "Updated a relationship" : `${method === "POST" ? "Added" : "Updated"} ${collection.people[id].name}`);
      return json({ id: id || null, revision: next });
    }
    throw new HttpError(404, "Not found.");
  }
  assert(method === "GET" || method === "HEAD", "Not allowed.", 405);
  if (path === "/favicon.svg") return asset(path);
  if (!user) return asset("/login.html");
  const treeRoute = /^\/trees\/[0-9a-f-]+\/?$/.test(path);
  assert(path === "/" || treeRoute || path === "/index.html", "Not found.", 404);
  return asset(treeRoute ? "/tree.html" : "/index.html");
}
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    let response: Response;
    try { response = await route(request, env); }
    catch (error) {
      if (error instanceof HttpError) response = json({ error: error.message }, error.status);
      else { console.error(JSON.stringify({ event: "request_failed", method: request.method, path: new URL(request.url).pathname })); response = json({ error: "Something went wrong. Please try again." }, 500); }
    }
    if (response.ok && !["GET", "HEAD"].includes(request.method) && !new URL(request.url).pathname.match(/\/(login|logout|google\/[^/]+)$/)) ctx.waitUntil(refreshBackup(env));
    const headers = new Headers(response.headers);
    if (!headers.has("cache-control")) headers.set("cache-control", "private, no-store");
    headers.set("x-content-type-options", "nosniff");
    headers.set("referrer-policy", "same-origin");
    headers.set("x-frame-options", "DENY");
    headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
    return new Response(request.method === "HEAD" ? null : response.body, { status: response.status, headers });
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) { ctx.waitUntil(refreshBackup(env)); },
} satisfies ExportedHandler<Env>;
