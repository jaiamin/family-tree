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
  const secure = new URL(request.url).protocol === "https:" || env.LOCAL_MODE !== "true";
  return `${name}=${value}; Path=${env.BASE_PATH || "/"}; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure ? "; Secure" : ""}`;
}
export async function roleFor(env: Env, email: string): Promise<Identity["role"] | null> {
  if (email === env.OWNER_EMAIL.toLowerCase()) return "owner";
  return await env.DB.prepare("SELECT email FROM editors WHERE email = ?").bind(email).first() ? "editor" : null;
}
export async function identity(request: Request, env: Env): Promise<Identity | null> {
  const authorization = request.headers.get("authorization") || "";
  if (authorization.startsWith("Bearer ") && await secretMatches(authorization.slice(7), env.MCP_TOKEN)) return { role: "owner", email: "MCP" };
  const token = cookie(request, "family_session");
  if (!token) return null;
  const session = await env.DB.prepare("SELECT email, credential FROM sessions WHERE token_hash = ? AND expires > ?")
    .bind(await sha256(token), now()).first<{ email: string | null; credential: string }>();
  if (!session) return null;
  if (session.email) {
    const role = await roleFor(env, session.email);
    const profile = session.credential.startsWith("{") ? JSON.parse(session.credential) : {};
    return role ? { email: session.email, role, name: profile.name, picture: profile.picture } : null;
  }
  if (!env.FAMILY_PASSWORD || session.credential !== await sha256(env.FAMILY_PASSWORD)) return null;
  return { email: null, role: "member" };
}
export function requireRole(user: Identity | null, role: "member" | "editor" | "owner" = "member"): asserts user is Identity {
  assert(user, "Please sign in.", 401);
  assert(role === "member" || user.role === "owner" || user.role === role, "You don't have access to make this change.", 403);
}
export function requireSameOrigin(request: Request, env: Env) {
  const origin = request.headers.get("origin");
  const allowed = env.PUBLIC_ORIGIN || new URL(request.url).origin;
  assert(origin === allowed || origin === new URL(request.url).origin || (request.headers.get("authorization") || "").startsWith("Bearer "), "This request must come from the family website.", 403);
}
export async function rateLimit(request: Request, env: Env, action: string, limit: number, seconds: number) {
  const ip = request.headers.get("cf-connecting-ip") || "local";
  const key = await sha256(`${env.FAMILY_PASSWORD || env.MCP_TOKEN}:${action}:${ip}`);
  const row = await env.DB.prepare(`INSERT INTO rate_limits(key, count, expires) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN expires <= ? THEN 1 ELSE count + 1 END,
    expires = CASE WHEN expires <= ? THEN excluded.expires ELSE expires END RETURNING count`)
    .bind(key, now() + seconds, now(), now()).first<{ count: number }>();
  assert(row && row.count <= limit, "Too many attempts. Please try again later.", 429);
}
export async function newSession(request: Request, env: Env, email: string | null, profile: { name?: string; picture?: string } = {}) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const seconds = email ? 86400 : 30 * 86400;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires <= ?").bind(now()),
    env.DB.prepare("INSERT INTO sessions(token_hash, email, credential, expires) VALUES (?, ?, ?, ?)")
      .bind(await sha256(token), email, email ? JSON.stringify(profile) : await sha256(env.FAMILY_PASSWORD!), now() + seconds),
  ]);
  return sessionCookie(request, env, "family_session", token, seconds);
}
export async function googleChallenge(request: Request, env: Env) {
  assert(env.GOOGLE_CLIENT_ID, "Editor sign-in hasn't been configured yet.", 503);
  await rateLimit(request, env, "google", 30, 600);
  const id = crypto.randomUUID(), nonce = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_challenges WHERE expires <= ?").bind(now()),
    env.DB.prepare("INSERT INTO login_challenges(id, nonce, expires) VALUES (?, ?, ?)").bind(await sha256(id), nonce, now() + 600),
  ]);
  return { nonce, cookie: sessionCookie(request, env, "google_challenge", id, 600) };
}
export async function googleLogin(request: Request, env: Env, token: string) {
  assert(env.GOOGLE_CLIENT_ID, "Editor sign-in hasn't been configured yet.", 503);
  const challenge = cookie(request, "google_challenge");
  assert(challenge, "Please start Google sign-in again.", 401);
  const row = await env.DB.prepare("DELETE FROM login_challenges WHERE id = ? AND expires > ? RETURNING nonce")
    .bind(await sha256(challenge), now()).first<{ nonce: string }>();
  assert(row, "Your sign-in has expired. Please try again.", 401);
  let payload;
  try {
    ({ payload } = await jwtVerify(token, googleKeys, {
      issuer: ["https://accounts.google.com", "accounts.google.com"], audience: env.GOOGLE_CLIENT_ID,
      algorithms: ["RS256"], requiredClaims: ["exp", "iat", "sub", "nonce"], maxTokenAge: "1h",
    }));
  } catch { throw new HttpError(401, "Google sign-in couldn't be verified. Please try again."); }
  assert(payload.nonce === row.nonce && payload.email_verified === true && typeof payload.email === "string", "Google sign-in couldn't be verified.", 401);
  const email = payload.email.toLowerCase();
  assert(await roleFor(env, email), "This Google account hasn't been given editor access.", 403);
  return newSession(request, env, email, {
    name: typeof payload.name === "string" ? payload.name.slice(0, 200) : undefined,
    picture: typeof payload.picture === "string" && /^https:\/\/[^/]+\.googleusercontent\.com\//.test(payload.picture) ? payload.picture : undefined,
  });
}
