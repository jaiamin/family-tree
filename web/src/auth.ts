import { createRemoteJWKSet, jwtVerify } from "jose";
import { assert, HttpError } from "./model";
import type { Env, Identity } from "./types";

const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const now = () => Math.floor(Date.now() / 1000);
export const sha256 = async (text: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, "0")).join("");

// Web Crypto's HMAC verification avoids comparing credentials with a timing-sensitive string comparison.
export async function secretMatches(candidate: string, expected?: string) {
  if (!expected || !candidate) return false;
  const algorithm = { name: "HMAC", hash: "SHA-256" };
  const message = new TextEncoder().encode("family-tree-credential-check");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(expected), algorithm, false, ["sign"]);
  const signature = await crypto.subtle.sign(algorithm, key, message);
  const supplied = await crypto.subtle.importKey("raw", new TextEncoder().encode(candidate), algorithm, false, ["verify"]);
  return crypto.subtle.verify(algorithm, supplied, signature, message);
}
export function cookie(request: Request, name: string) {
  return request.headers.get("cookie")?.split(";").map(p => p.trim()).find(p => p.startsWith(`${name}=`))?.slice(name.length + 1) || "";
}
export function sessionCookie(request: Request, env: Env, name: string, value: string, seconds: number) {
  const secure = new URL(request.url).protocol === "https:" || env.DEVELOPMENT !== "true";
  return `${name}=${value}; Path=${env.BASE_PATH || "/"}; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure ? "; Secure" : ""}`;
}
export async function identity(request: Request, env: Env): Promise<Identity | null> {
  const authorization = request.headers.get("authorization") || "";
  if (authorization.startsWith("Bearer ")) {
    const row = await env.DB.prepare(`SELECT u.*, a.id AS automation_id FROM automation_credentials a JOIN users u ON u.id=a.user_id WHERE a.token_hash=? AND u.enabled=1 AND u.role='owner'`).bind(await sha256(authorization.slice(7))).first<UserRow & { automation_id: string }>();
    return row && row.email.toLowerCase() === env.OWNER_EMAIL?.toLowerCase() ? userIdentity(row, row.automation_id) : null;
  }
  const token = cookie(request, "family_session");
  if (token) {
    const row = await env.DB.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>? AND s.auth_version=u.auth_version AND u.enabled=1`).bind(await sha256(token), now()).first<UserRow>();
    if (row && (row.role !== "owner" || row.email?.toLowerCase() === env.OWNER_EMAIL?.toLowerCase())) return userIdentity(row);
  }
  const viewer = cookie(request, "family_viewer");
  if (!viewer || !env.FAMILY_PASSWORD) return null;
  const session = await env.DB.prepare("SELECT 1 FROM sessions WHERE token_hash=? AND user_id IS NULL AND viewer_key=? AND expires>?").bind(await sha256(viewer), await sha256(env.FAMILY_PASSWORD), now()).first();
  return session ? { id: "viewer", role: "viewer", email: null, name: "Family viewer" } : null;
}
export interface UserRow { id: string; role: Identity["role"]; email: string; name: string; picture?: string; auth_version: number }
export function userIdentity(row: UserRow, automationId?: string): Identity {
  return { id: row.id, role: row.role, email: row.email, name: row.name, picture: row.picture, ...automationId ? { automationId } : {} };
}
export function requireRole(user: Identity | null, role: "viewer" | "editor" | "owner" = "viewer"): asserts user is Identity {
  assert(user, "Please sign in.", 401);
  assert(role === "viewer" || user.role === "owner" || user.role === role, "You don't have access to make this change.", 403);
}
export function requireSameOrigin(request: Request, env: Env) {
  const origin = request.headers.get("origin");
  const allowed = env.PUBLIC_ORIGIN || new URL(request.url).origin;
  assert(origin === allowed || origin === new URL(request.url).origin || (request.headers.get("authorization") || "").startsWith("Bearer "), "This request must come from the family website.", 403);
}
export async function rateLimit(request: Request, env: Env, action: string, limit: number, seconds: number) {
  const ip = env.CLIENT_IP || "unknown";
  const key = await sha256(`${action}:${ip}`);
  const row = await env.DB.prepare(`INSERT INTO rate_limits(key, count, expires) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN expires <= ? THEN 1 ELSE count + 1 END,
    expires = CASE WHEN expires <= ? THEN excluded.expires ELSE expires END RETURNING count`)
    .bind(key, now() + seconds, now(), now()).first<{ count: number }>();
  assert(row && row.count <= limit, "Too many attempts. Please try again later.", 429);
}
export async function newSession(request: Request, env: Env, userId: string) {
  const user = await env.DB.prepare("SELECT auth_version FROM users WHERE id=? AND enabled=1").bind(userId).first<{ auth_version: number }>();
  assert(user, "Please sign in.", 401);
  const token = crypto.randomUUID() + crypto.randomUUID(), seconds = 7 * 86400;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires <= ?").bind(now()),
    env.DB.prepare("INSERT INTO sessions(token_hash,user_id,auth_version,expires) VALUES(?,?,?,?)").bind(await sha256(token),userId,user.auth_version,now()+seconds),
  ]);
  return sessionCookie(request,env,"family_session",token,seconds);
}
export async function newViewerSession(request: Request, env: Env) {
  assert(env.FAMILY_PASSWORD, "The family password hasn't been configured.", 503);
  const token = crypto.randomUUID() + crypto.randomUUID(), seconds = 30 * 86400;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires<=?").bind(now()),
    env.DB.prepare("INSERT INTO sessions(token_hash,user_id,auth_version,viewer_key,expires) VALUES(?,NULL,0,?,?)").bind(await sha256(token), await sha256(env.FAMILY_PASSWORD), now()+seconds),
  ]);
  return sessionCookie(request, env, "family_viewer", token, seconds);
}
export async function googleChallenge(request: Request, env: Env) {
  assert(env.GOOGLE_CLIENT_ID && env.OWNER_EMAIL, "Editor sign-in hasn't been configured.", 503);
  await rateLimit(request, env, "google", 30, 600);
  const id=crypto.randomUUID(), nonce=crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_challenges WHERE expires<=?").bind(now()),
    env.DB.prepare("INSERT INTO login_challenges(id,nonce,expires) VALUES(?,?,?)").bind(await sha256(id),nonce,now()+600),
  ]);
  return {nonce,cookie:sessionCookie(request,env,"google_challenge",id,600)};
}
export async function googleLogin(request: Request, env: Env, token: string) {
  assert(env.GOOGLE_CLIENT_ID && env.OWNER_EMAIL, "Editor sign-in hasn't been configured.", 503);
  const challenge=cookie(request,"google_challenge");
  assert(challenge,"Please start Google sign-in again.",401);
  const row=await env.DB.prepare("DELETE FROM login_challenges WHERE id=? AND expires>? RETURNING nonce").bind(await sha256(challenge),now()).first<{nonce:string}>();
  assert(row,"Your sign-in has expired. Please try again.",401);
  let payload;
  try { ({payload}=await jwtVerify(token,googleKeys,{issuer:["https://accounts.google.com","accounts.google.com"],audience:env.GOOGLE_CLIENT_ID,algorithms:["RS256"],requiredClaims:["exp","iat","sub","nonce"],maxTokenAge:"1h"})); }
  catch { throw new HttpError(401,"Google sign-in couldn't be verified. Please try again."); }
  assert(payload.nonce===row.nonce && payload.email_verified===true && typeof payload.sub==='string' && typeof payload.email==='string',"Google sign-in couldn't be verified.",401);
  const email = payload.email.toLowerCase();
  const name = typeof payload.name === "string" ? payload.name.slice(0,100) : email;
  const picture = typeof payload.picture === "string" && /^https:\/\/[^/]+\.googleusercontent\.com\//.test(payload.picture) ? payload.picture : null;
  if (email === env.OWNER_EMAIL.toLowerCase()) {
    // Configuration is the authority for ownership; an old owner never retains access.
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET role='editor',enabled=0,auth_version=auth_version+1 WHERE role='owner' AND email!=? COLLATE NOCASE").bind(email),
      env.DB.prepare("INSERT INTO users(id,email,name,role) VALUES(?,?,?,'owner') ON CONFLICT(email) DO UPDATE SET role='owner',enabled=1").bind(crypto.randomUUID(),email,name),
    ]);
  }
  const approved = await env.DB.prepare("SELECT * FROM users WHERE email=? AND enabled=1").bind(email).first<UserRow>();
  assert(approved, "This Google account doesn't have editing access.", 403);
  await env.DB.prepare("INSERT OR IGNORE INTO identities(provider,subject,user_id) VALUES('google',?,?)").bind(payload.sub,approved.id).run();
  const linked = await env.DB.prepare("SELECT 1 FROM identities WHERE provider='google' AND subject=? AND user_id=?").bind(payload.sub,approved.id).first();
  assert(linked, "This Google account doesn't match the approved identity.", 403);
  await env.DB.prepare("UPDATE users SET name=?,picture=? WHERE id=?").bind(name,picture,approved.id).run();
  return newSession(request,env,approved.id);
}
