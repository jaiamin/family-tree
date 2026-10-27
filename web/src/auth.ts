import { createRemoteJWKSet, jwtVerify } from "jose";
import { audited } from "./activity";
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
    return row ? userIdentity(row, row.automation_id) : null;
  }
  const token = cookie(request, "family_session");
  if (!token) return null;
  const row = await env.DB.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>? AND s.auth_version=u.auth_version AND u.enabled=1`).bind(await sha256(token), now()).first<UserRow>();
  return row ? userIdentity(row) : null;
}
export interface UserRow { id: string; role: Identity["role"]; email: string | null; name: string; picture?: string; auth_version: number; password_hash: string; recovery_hash?: string }
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
  const ip = env.CLIENT_IP || request.headers.get("cf-connecting-ip") || "unknown";
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
export async function googleChallenge(request: Request, env: Env, user?: Identity | null) {
  assert(env.GOOGLE_CLIENT_ID, "Google sign-in hasn't been configured.", 503);
  await rateLimit(request, env, "google", 30, 600);
  const id=crypto.randomUUID(), nonce=crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_challenges WHERE expires<=?").bind(now()),
    env.DB.prepare("INSERT INTO login_challenges(id,nonce,expires,user_id) VALUES(?,?,?,?)").bind(await sha256(id),nonce,now()+600,user?.id || null),
  ]);
  return {nonce,cookie:sessionCookie(request,env,"google_challenge",id,600)};
}
export async function googleLogin(request: Request, env: Env, token: string, user?: Identity | null) {
  assert(env.GOOGLE_CLIENT_ID, "Google sign-in hasn't been configured.", 503);
  const challenge=cookie(request,"google_challenge");
  assert(challenge,"Please start Google sign-in again.",401);
  const row=await env.DB.prepare("DELETE FROM login_challenges WHERE id=? AND expires>? RETURNING nonce,user_id").bind(await sha256(challenge),now()).first<{nonce:string;user_id:string|null}>();
  assert(row,"Your sign-in has expired. Please try again.",401);
  let payload;
  try { ({payload}=await jwtVerify(token,googleKeys,{issuer:["https://accounts.google.com","accounts.google.com"],audience:env.GOOGLE_CLIENT_ID,algorithms:["RS256"],requiredClaims:["exp","iat","sub","nonce"],maxTokenAge:"1h"})); }
  catch { throw new HttpError(401,"Google sign-in couldn't be verified. Please try again."); }
  assert(payload.nonce===row.nonce && payload.email_verified===true && typeof payload.sub==='string',"Google sign-in couldn't be verified.",401);
  if (row.user_id) {
    assert(user && !user.automationId && user.id===row.user_id,"Sign in to the account you are linking.",401);
    const existing=await env.DB.prepare("SELECT user_id FROM identities WHERE provider='google' AND subject=?").bind(payload.sub).first<{user_id:string}>();
    assert(!existing || existing.user_id===user.id,"This Google account is already linked.",409);
    const email = typeof payload.email === "string" ? payload.email.slice(0,254) : user.email;
    const picture = typeof payload.picture === "string" && /^https:\/\/[^/]+\.googleusercontent\.com\//.test(payload.picture) ? payload.picture : null;
    await audited(env,user,"google.linked",[
      env.DB.prepare("INSERT INTO identities(provider,subject,user_id) VALUES('google',?,?) ON CONFLICT(provider,user_id) DO UPDATE SET subject=excluded.subject").bind(payload.sub,user.id),
      env.DB.prepare("UPDATE users SET email=?,picture=? WHERE id=?").bind(email,picture,user.id),
    ]);
  }
  const linked=await env.DB.prepare("SELECT u.id FROM identities i JOIN users u ON u.id=i.user_id WHERE i.provider='google' AND i.subject=? AND u.enabled=1").bind(payload.sub).first<{id:string}>();
  assert(linked,"This Google account is not linked to an approved account.",403);
  return newSession(request,env,linked.id);
}
