import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import { runtime } from "../scripts/runtime.mjs";
import { SignJWT, exportJWK } from "jose";

const origin = "http://localhost", base = "/family-tree";
const ownerHeaders = { authorization: "Bearer local-test-owner-token" };
let mf, db, familyCookie, treeId, treeShortId, parentId, childId;
const google = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = await exportJWK(google.publicKey); jwk.kid = "test-google-key"; jwk.alg = "RS256"; jwk.use = "sig";
const outboundService = async request => {
  if (request.url === "https://www.googleapis.com/oauth2/v3/certs") return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } });
  throw new Error(`Unexpected outbound request to ${new URL(request.url).hostname}`);
};
async function call(path, { body, method = body === undefined ? "GET" : "POST", cookie, owner, headers = {} } = {}) {
  return mf.dispatchFetch(`${origin}${base}/api${path}`, { method, headers: {
    ...body === undefined ? {} : { "content-type": "application/json", origin },
    ...cookie ? { cookie } : {}, ...owner ? ownerHeaders : {}, ...headers,
  }, body: body === undefined ? undefined : JSON.stringify(body) });
}
const cookieFrom = response => response.headers.get("set-cookie")?.split(";")[0];
async function signIn(email, { verified = true, nonceOverride, name, picture, audience = "207540522825-6h5fk3lfe0jhcddpbmrm6e1n8i2rur02.apps.googleusercontent.com" } = {}) {
  const challenge = await call("/google/start", { body: {} });
  const { nonce } = await challenge.json();
  const credential = await new SignJWT({ email, name, picture, email_verified: verified, nonce: nonceOverride || nonce }).setProtectedHeader({ alg: "RS256", kid: jwk.kid }).setSubject("google-subject")
    .setIssuer("https://accounts.google.com").setAudience(audience).setIssuedAt().setExpirationTime("5m").sign(google.privateKey);
  const cookie = cookieFrom(challenge);
  const response = await call("/google/login", { body: { credential }, cookie });
  return { response, credential, challengeCookie: cookie };
}
before(async () => {
  mf = await runtime({ outboundService }); db = await mf.getD1Database("DB");
  treeId = randomUUID(); parentId = randomUUID(); childId = randomUUID();
  const collection = {
    version: 1, site: { name: "Chha Gam", url: "https://example.com/family-tree" },
    people: {
      [parentId]: { id: parentId, name: "Parent", parents: [], partners: [], birth_date: "1960-01-01", notes: "Private family note" },
      [childId]: { id: childId, name: "Child", parents: [parentId], partners: [] },
    }, partnerships: {}, trees: { [treeId]: { id: treeId, name: "Family", members: [parentId, childId] } },
  };
  const response = await call("/collection", { body: { collection, revision: 0 }, method: "PUT", owner: true });
  assert.equal(response.status, 200, await response.text());
  treeShortId = (await db.prepare("SELECT short_id FROM public_ids WHERE kind = 'tree' AND entity_id = ?").bind(treeId).first()).short_id;
});
after(async () => { await mf?.dispose(); });

test("anonymous visitors cannot read records, photos, or an HTML-embedded collection", async () => {
  for (const path of ["/view", "/collection", "/photos", `/photos/${parentId}`, "/suggestions"]) {
    const response = await call(path); assert.equal(response.status, 401, path); assert.match(response.headers.get("cache-control"), /no-store/);
  }
  const page = await mf.dispatchFetch(`${origin}${base}/t/${treeShortId}/`);
  const html = await page.text(); assert.match(html, /family-password/); assert.ok(!html.includes("Private family note")); assert.ok(!html.includes(parentId));
  assert.equal((await mf.dispatchFetch(`${origin}/api/view`)).status, 404);
});
test("family password grants viewing, with a private path-scoped session", async () => {
  assert.equal((await call("/login", { body: { password: "wrong" } })).status, 403);
  const login = await call("/login", { body: { password: "local-preview-only" } }); assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /HttpOnly; SameSite=Lax/); assert.match(login.headers.get("set-cookie"), /Path=\/family-tree/);
  familyCookie = cookieFrom(login);
  const response = await call(`/view?tree=${treeShortId}`, { cookie: familyCookie });
  assert.equal(response.status, 200); assert.equal((await response.json()).tree.people[parentId].birth_date, "1960-01-01");
  const page = await mf.dispatchFetch(`${origin}${base}/t/${treeShortId}/`, { headers: { cookie: familyCookie } });
  assert.ok(!(await page.text()).includes("Private family note"), "HTML is a data-free shell, records arrive only through authenticated API");
});
test("canonical home and deep tree URLs render authenticated shells without redirecting", async () => {
  for (const path of [base, `${base}/t/${treeShortId}`, `${base}/t/${treeShortId}/`]) {
    const response = await mf.dispatchFetch(`${origin}${path}`, { headers: { cookie: familyCookie } });
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("location"), null, path);
    const html = await response.text();
    assert.match(html, /id="title"/);
    assert.ok(html.includes(`href="${base}"`), "home link uses the proxy-safe canonical path");
    assert.ok(!html.includes(`href="${base}/"`), "home link must not reintroduce the failing trailing slash");
  }
});
test("family members may suggest but cannot read suggestions, edit records, or create trees", async () => {
  const added = await call("/suggestions", { cookie: familyCookie, body: { personId: parentId, name: "A relative", message: "Please check this date", contact: "" } });
  assert.equal(added.status, 201);
  assert.equal((await call("/suggestions", { cookie: familyCookie })).status, 403);
  assert.equal((await call(`/people/${parentId}`, { method: "PATCH", body: { revision: 1, fields: { name: "Changed" } }, cookie: familyCookie })).status, 403);
  assert.equal((await call("/trees", { body: { name: "New tree" }, cookie: familyCookie })).status, 404);
  assert.equal((await call("/suggestions", { owner: true }).then(r => r.json()))[0].person_name, "Parent");
});
test("Google tokens require the approved email, audience, verified email, and one-time nonce", async () => {
  for (const [email, options, status] of [["stranger@example.com", {}, 403], ["mehul@mehulamin.com", { verified: false }, 401], ["mehul@mehulamin.com", { nonceOverride: "wrong" }, 401], ["mehul@mehulamin.com", { audience: "wrong" }, 401]]) {
    const result = await signIn(email, options); assert.equal(result.response.status, status);
  }
  const signed = await signIn("mehul@mehulamin.com", { name: "Test Editor", picture: "https://lh3.googleusercontent.com/test-photo" }); assert.equal(signed.response.status, 200);
  assert.equal((await call("/google/login", { body: { credential: signed.credential }, cookie: signed.challengeCookie })).status, 401, "nonce cannot be replayed");
  const cookie = cookieFrom(signed.response);
  const profile = await (await call("/session", { cookie })).json();
  assert.equal(profile.name, "Test Editor");
  assert.equal(profile.picture, "https://lh3.googleusercontent.com/test-photo");
  assert.equal(profile.email, "mehul@mehulamin.com");
  assert.equal((await call("/editors", { cookie })).status, 403);
  assert.equal((await call("/suggestions", { cookie })).status, 200);
  await call("/editors", { owner: true, method: "DELETE", body: { email: "mehul@mehulamin.com" } });
  assert.equal((await call("/suggestions", { cookie })).status, 401, "revocation invalidates existing editor sessions");
  await call("/editors", { owner: true, body: { email: "mehul@mehulamin.com" } });
});
test("same revision cannot overwrite a concurrent update; invalid ancestry is rejected atomically", async () => {
  const current = await (await call("/collection", { owner: true })).json();
  const edits = await Promise.all(["First name", "Second name"].map(name => call(`/people/${parentId}`, { method: "PATCH", owner: true, body: { revision: current.revision, fields: { name } } })));
  assert.deepEqual(edits.map(r => r.status).sort(), [200, 409]);
  const after = await (await call("/collection", { owner: true })).json(); assert.equal(after.revision, current.revision + 1);
  const cycle = await call("/relationships", { owner: true, body: { revision: after.revision, personId: parentId, relativeId: childId, relation: "parent" } });
  assert.equal(cycle.status, 400); assert.equal((await (await call("/collection", { owner: true })).json()).revision, after.revision);
  const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  for (const name of ["people", "parents", "partnerships", "trees", "tree_members"]) assert.ok(tables.results.some(t => t.name === name));
});
test("photos are private, viewers cannot remove them, and replacement preserves uploads", async () => {
  const bytes = new Uint8Array([255,216,255,224,0,0]);
  const upload = () => mf.dispatchFetch(`${origin}${base}/api/photos/${parentId}`, { method: "PUT", headers: { origin, cookie: familyCookie, "content-type": "image/jpeg" }, body: bytes });
  assert.equal((await upload()).status, 200); assert.equal((await upload()).status, 200);
  const rows = await db.prepare("SELECT * FROM photo_uploads WHERE person_id = ?").bind(parentId).all(); assert.equal(rows.results.length, 2);
  for (const binding of ["PHOTOS", "BACKUP"]) {
    const bucket = await mf.getR2Bucket(binding);
    for (const file of rows.results) assert.ok(await bucket.head(file.object_key));
  }
  assert.equal((await call(`/photos/${parentId}`)).status, 401);
  assert.equal((await call(`/photos/${parentId}`, { cookie: familyCookie, method: "DELETE", headers: { origin } })).status, 403);
  assert.equal((await call(`/photos/${parentId}`, { cookie: familyCookie })).status, 200);
});
test("mutations reject cross-site requests and backup contains recoverable records and photo references", async () => {
  assert.equal((await call("/suggestions", { cookie: familyCookie, body: { name: "X", message: "X" }, headers: { origin: "https://other.example" } })).status, 403);
  await mf.waitForOutput?.();
  // dispatchFetch waitUntil work completes before the next storage read in the runtime.
  const bucket = await mf.getR2Bucket("BACKUP");
  let object;
  for (let n = 0; n < 20; n++) { object = await bucket.get("collection.json"); if (object) { const value = JSON.parse(await object.text()); if (value.uploads.length === 2) { assert.ok(value.collection.people[parentId]); assert.equal(value.suggestions.length, 1); assert.equal(value.photos.length, 1); return; } } await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.fail("Expected the current rolling backup, including retained uploads");
});

test("editors can add relatives, reuse a shared UUID across trees, and review private suggestions", async () => {
  const signed = await signIn("mehul@mehulamin.com"), cookie = cookieFrom(signed.response);
  let current = await (await call("/collection", { owner: true })).json();
  const otherTree = randomUUID(), sharedId = randomUUID();
  current.collection.people[sharedId] = { id: sharedId, name: "Existing relative", parents: [], partners: [] };
  current.collection.trees[otherTree] = { id: otherTree, name: "Other family", members: [sharedId] };
  assert.equal((await call("/collection", { owner: true, method: "PUT", body: current })).status, 200);
  current = await (await call("/collection", { owner: true })).json();
  assert.equal((await call("/people", { cookie: familyCookie })).status, 403);
  assert.ok((await (await call("/people", { cookie })).json()).some(p => p.id === sharedId));
  const linked = await call("/relationships", { cookie, body: { revision: current.revision, treeId, personId: childId, relativeId: sharedId, relation: "partner", status: "married" } });
  assert.equal(linked.status, 200, await linked.text());
  current = await (await call("/collection", { owner: true })).json();
  assert.ok(current.collection.trees[treeId].members.includes(sharedId));
  assert.ok(current.collection.trees[otherTree].members.includes(sharedId));
  assert.equal(Object.keys(current.collection.people).length, 3);
  const added = await call("/people", { cookie, body: { revision: current.revision, treeId, relativeId: childId, relation: "child", fields: { name: "New child", sex: "female" } } });
  assert.equal(added.status, 200);
  const { id } = await added.json();
  current = await (await call("/collection", { owner: true })).json();
  assert.deepEqual(current.collection.people[id].parents, [childId]);
  assert.deepEqual(current.collection.people[sharedId].parents, [], "Adding a child never assumes the partner is a parent");
  const suggestions = await (await call("/suggestions", { cookie })).json();
  assert.equal(suggestions[0].tree_id, treeId, "Suggestions link back to the person’s tree");
  assert.equal((await call(`/suggestions/${suggestions[0].id}`, { cookie, method: "PATCH", body: { status: "done" } })).status, 200);
  assert.equal((await (await call("/suggestions", { cookie })).json())[0].status, "done");
});

test("malformed edits fail without partial changes or internal errors", async () => {
  const current = await (await call("/collection", { owner: true })).json();
  for (const fields of [null, [], "wrong", { name: null }, { notes: {} }, { unknown: "value" }]) {
    assert.equal((await call(`/people/${parentId}`, { owner: true, method: "PATCH", body: { revision: current.revision, fields } })).status, 400);
  }
  for (const collection of [null, [], { ...current.collection, people: [] }, { ...current.collection, people: { [parentId]: null } }, { ...current.collection, partnerships: { "bad": null } }]) {
    assert.equal((await call("/collection", { owner: true, method: "PUT", body: { revision: current.revision, collection } })).status, 400);
  }
  assert.equal((await call("/suggestions", { cookie: familyCookie, body: null })).status, 400);
  assert.equal((await (await call("/collection", { owner: true })).json()).revision, current.revision);
});

test("a failed photo-pointer commit keeps the current photo and both retained copies", async () => {
  const before = await db.prepare("SELECT * FROM photos WHERE person_id = ?").bind(parentId).first();
  await db.exec("CREATE TRIGGER simulate_photo_failure BEFORE UPDATE ON photos BEGIN SELECT RAISE(ABORT, 'Simulated storage failure'); END");
  try {
    const response = await mf.dispatchFetch(`${origin}${base}/api/photos/${parentId}`, { method: "PUT", headers: { origin, cookie: familyCookie, "content-type": "image/jpeg" }, body: new Uint8Array([255,216,255,225,1]) });
    assert.equal(response.status, 500);
    assert.deepEqual(await db.prepare("SELECT * FROM photos WHERE person_id = ?").bind(parentId).first(), before);
    for (const binding of ["PHOTOS", "BACKUP"]) assert.ok(await (await mf.getR2Bucket(binding)).head(before.object_key));
  } finally { await db.exec("DROP TRIGGER simulate_photo_failure"); }
});

test("Google editors remove only the current photo pointer and retain all uploaded files", async () => {
  const bytes = new Uint8Array([255,216,255,224,0,0]);
  const upload = await mf.dispatchFetch(`${origin}${base}/api/photos/${childId}`, { method: "PUT", headers: { origin, cookie: familyCookie, "content-type": "image/jpeg" }, body: bytes });
  assert.equal(upload.status, 200);
  const pointer = await db.prepare("SELECT * FROM photos WHERE person_id = ?").bind(childId).first();
  const signed = await signIn("mehul@mehulamin.com");
  assert.equal(signed.response.status, 200);
  assert.equal((await call(`/photos/${childId}`, { method: "DELETE", cookie: cookieFrom(signed.response), headers: { origin } })).status, 200);
  assert.equal((await call(`/photos/${childId}`, { cookie: familyCookie })).status, 404);
  assert.equal((await (await call("/photos", { cookie: familyCookie })).json())[childId], undefined);
  assert.equal((await db.prepare("SELECT * FROM photo_uploads WHERE person_id = ?").bind(childId).all()).results.length, 1);
  for (const binding of ["PHOTOS", "BACKUP"]) assert.ok(await (await mf.getR2Bucket(binding)).head(pointer.object_key));
  const again = await mf.dispatchFetch(`${origin}${base}/api/photos/${childId}`, { method: "PUT", headers: { origin, cookie: familyCookie, "content-type": "image/jpeg" }, body: bytes });
  assert.equal(again.status, 200, "viewers can add a photo again after removal");
});

test("editor sign-out rotates into viewer access; viewer sign-out ends access", async () => {
  const signed = await signIn("mehul@mehulamin.com");
  assert.equal(signed.response.status, 200);
  const editorCookie = cookieFrom(signed.response);
  const leaveEditing = await call("/logout", { body: {}, cookie: editorCookie });
  assert.equal(leaveEditing.status, 200);
  const viewerCookie = cookieFrom(leaveEditing);
  assert.notEqual(viewerCookie, editorCookie);
  assert.equal((await call("/view", { cookie: editorCookie })).status, 401, "old editor session is revoked");
  const viewer = await (await call("/session", { cookie: viewerCookie })).json();
  assert.equal(viewer.role, "member");
  assert.equal(viewer.email, null);
  assert.equal((await call("/view", { cookie: viewerCookie })).status, 200);
  assert.equal((await call("/suggestions", { cookie: viewerCookie })).status, 403);
  assert.equal((await call("/logout", { body: {}, cookie: viewerCookie })).status, 200);
  assert.equal((await call("/view", { cookie: viewerCookie })).status, 401);
  assert.equal((await call("/logout", { body: {} })).status, 200, "anonymous logout never grants viewing");
});

test("only the owner can delete a person everywhere, with revision and name confirmation", async () => {
  const victim = randomUUID(), otherTree = randomUUID();
  const snapshot = await (await call("/collection", { owner: true })).json();
  snapshot.collection.people[victim] = { id: victim, name: "Delete Test Person", parents: [], partners: [parentId] };
  snapshot.collection.people[parentId].partners.push(victim);
  snapshot.collection.people[childId].parents.push(victim);
  snapshot.collection.partnerships[[victim, parentId].sort().join("+")] = { status: "married" };
  snapshot.collection.trees[treeId].members.push(victim);
  snapshot.collection.trees[otherTree] = { id: otherTree, name: "Second tree", members: [victim] };
  const seeded = await call("/collection", { owner: true, method: "PUT", body: { collection: snapshot.collection, revision: snapshot.revision } });
  assert.equal(seeded.status, 200);
  const { revision } = await seeded.json();
  assert.equal((await mf.dispatchFetch(`${origin}${base}/api/photos/${victim}`, { method: "PUT", headers: { ...ownerHeaders, "content-type": "image/jpeg" }, body: new Uint8Array([255,216,255,224,0,0]) })).status, 200);
  const upload = await db.prepare("SELECT * FROM photo_uploads WHERE person_id = ?").bind(victim).first();
  const body = { revision, name: "Delete Test Person" }, path = `/people/${victim}`;
  assert.equal((await call(path, { method: "DELETE", body, cookie: familyCookie })).status, 403);
  const editor = await signIn("mehul@mehulamin.com");
  assert.equal((await call(path, { method: "DELETE", body, cookie: cookieFrom(editor.response) })).status, 403);
  assert.equal((await call(path, { method: "DELETE", owner: true, body: { ...body, name: "Wrong" } })).status, 400);
  assert.equal((await call(path, { method: "DELETE", owner: true, body: { ...body, revision: revision - 1 } })).status, 409);
  assert.ok((await (await call("/collection", { owner: true })).json()).collection.people[victim]);
  assert.equal((await call(path, { method: "DELETE", owner: true, body })).status, 200);
  const after = (await (await call("/collection", { owner: true })).json()).collection;
  assert.equal(after.people[victim], undefined);
  for (const person of Object.values(after.people)) { assert.ok(!person.parents.includes(victim)); assert.ok(!person.partners.includes(victim)); }
  for (const tree of Object.values(after.trees)) assert.ok(!tree.members.includes(victim));
  assert.deepEqual(await db.prepare("PRAGMA foreign_key_check").all().then(r => r.results), []);
  assert.ok(!Object.keys(after.partnerships).some(key => key.includes(victim)));
  assert.equal(await db.prepare("SELECT * FROM photos WHERE person_id = ?").bind(victim).first(), null);
  assert.ok(await db.prepare("SELECT * FROM photo_uploads WHERE id = ?").bind(upload.id).first());
  for (const binding of ["PHOTOS", "BACKUP"]) assert.ok(await (await mf.getR2Bucket(binding)).head(upload.object_key));
});

test("only editors may delete suggestions, without changing people or other suggestions", async () => {
  const signed = await signIn("mehul@mehulamin.com"), cookie = cookieFrom(signed.response);
  const first = await call("/suggestions", { cookie: familyCookie, body: { name: "Test sender", message: "Delete this test suggestion" } });
  assert.equal(first.status, 201);
  const { id } = await first.json();
  const before = await (await call("/collection", { owner: true })).json();
  const remaining = (await (await call("/suggestions", { owner: true })).json()).filter(item => item.id !== id);
  assert.equal((await call(`/suggestions/${id}`, { cookie: familyCookie, method: "DELETE", headers: { origin } })).status, 403);
  assert.equal((await call(`/suggestions/${id}`, { method: "DELETE", headers: { origin } })).status, 401);
  assert.equal((await call(`/suggestions/${id}`, { cookie, method: "DELETE", headers: { origin: "https://other.example" } })).status, 403);
  assert.equal((await call(`/suggestions/${id}`, { cookie, method: "DELETE", headers: { origin } })).status, 200);
  assert.deepEqual(await (await call("/suggestions", { owner: true })).json(), remaining);
  assert.deepEqual(await (await call("/collection", { owner: true })).json(), before);
  assert.equal((await call(`/suggestions/${id}`, { cookie, method: "DELETE", headers: { origin } })).status, 404);
  assert.equal((await call("/suggestions/invalid", { cookie, method: "DELETE", headers: { origin } })).status, 400);
});
