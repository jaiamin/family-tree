import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { SignJWT, exportJWK } from "jose";
import { runtime } from "../scripts/runtime.mjs";

const origin = "https://family.test", base = `${origin}/family-tree/api`;
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...await exportJWK(keys.publicKey), kid: "access-test", alg: "RS256", use: "sig" };
const outboundService = async request => {
  assert.equal(request.url, "https://www.googleapis.com/oauth2/v3/certs");
  return Response.json({ keys: [jwk] });
};
function browser(mf) {
  const jar = new Map();
  return { jar, async call(path, body, method = body === undefined ? "GET" : "POST") {
    const response = await mf.dispatchFetch(`${base}${path}`, { method,
      headers: { origin, cookie: [...jar].map(([name,value])=>`${name}=${value}`).join("; "), "content-type":"application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) });
    for (const header of response.headers.getSetCookie()) {
      const [name,value] = header.split(";")[0].split("=");
      if (value) jar.set(name,value); else jar.delete(name);
    }
    return response;
  }};
}
async function google(client, email, subject = email) {
  const challenge = await client.call("/google/start", {});
  assert.equal(challenge.status,200);
  const { nonce } = await challenge.json();
  const credential = await new SignJWT({ email, email_verified:true, nonce, name:"Relative" })
    .setProtectedHeader({alg:"RS256",kid:jwk.kid}).setSubject(subject).setIssuer("https://accounts.google.com")
    .setAudience("access-client").setIssuedAt().setExpirationTime("5m").sign(keys.privateKey);
  return client.call("/google/login", { credential });
}
test("Google approval, subject binding, revocation and two-stage logout preserve the viewer gate", async () => {
  const mf = await runtime({ bindings:{GOOGLE_CLIENT_ID:"access-client"}, outboundService });
  const owner = browser(mf), relative = browser(mf), db = await mf.getD1Database("DB");
  try {
    assert.equal((await owner.call("/google/start",{})).status,401);
    for (const client of [owner,relative]) assert.equal((await client.call("/login",{password:"local-preview-only"})).status,200);
    assert.equal((await google(relative,"unapproved@example.com")).status,403);
    assert.equal((await relative.call("/view")).status,200);
    assert.equal((await google(owner,"owner@example.com")).status,200,"configured owner bootstraps without an account password");
    const approved = await owner.call("/users",{email:"relative@example.com"});assert.equal(approved.status,201);
    const { id } = await approved.json();
    assert.equal((await google(relative,"relative@example.com","original-google-subject")).status,200);
    assert.equal((await relative.call("/suggestions")).status,200);
    assert.equal((await relative.call("/logout/editing",{})).status,200);
    assert.equal((await relative.call("/view")).status,200);
    assert.equal((await relative.call("/suggestions")).status,403);
    assert.equal((await google(relative,"relative@example.com","different-subject")).status,403,"email reuse cannot replace the bound identity");
    assert.equal((await google(relative,"relative@example.com","original-google-subject")).status,200);
    assert.equal((await owner.call(`/users/${id}`,{enabled:false},"PATCH")).status,200);
    assert.equal((await relative.call("/suggestions")).status,403,"revoked editing falls back only to their existing viewer session");
    assert.equal((await google(relative,"relative@example.com","original-google-subject")).status,403);
    assert.equal((await owner.call(`/users/${id}`,{enabled:true},"PATCH")).status,200);
    assert.equal((await relative.call("/suggestions")).status,403,"restoring approval does not reactivate old sessions");
    await owner.call("/logout/editing",{});
    assert.equal((await owner.call("/session").then(r=>r.json())).role,"viewer");
    await owner.call("/logout",{});
    assert.equal((await owner.call("/view")).status,401);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM users").first()).n,2);
  } finally { await mf.dispose(); }
});
test("rotating the shared password revokes old viewing sessions", async () => {
  const mf = await runtime();
  const viewer = browser(mf), db = await mf.getD1Database("DB");
  try {
    await viewer.call("/login",{password:"local-preview-only"});
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode("previous-password")))].map(v=>v.toString(16).padStart(2,"0")).join("");
    await db.prepare("UPDATE sessions SET viewer_key=? WHERE user_id IS NULL").bind(hash).run();
    assert.equal((await viewer.call("/view")).status,401);
    assert.equal((await viewer.call("/login",{password:"local-preview-only"})).status,200);
    assert.equal((await viewer.call("/view")).status,200);
  } finally { await mf.dispose(); }
});
