import { assert, uuid } from "../model";
import { bodyOf, text } from "../http";
import { cookie, newSession, rateLimit, requireRole, secretMatches, sessionCookie, sha256, type UserRow } from "../auth";
import { hashPassword, validatePassword, verifyPassword } from "./password";
import type { Env, Identity } from "../types";

const now = () => Math.floor(Date.now() / 1000);
const token = () => crypto.randomUUID() + crypto.randomUUID();
const json = Response.json;
const publicUser = "id,username,name,email,role,enabled,created_at";
function credentials(body: Record<string, unknown>) {
  const username = text(body.username, 64, true).toLowerCase();
  assert(/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username), "Use 3–64 letters, numbers, dots, dashes or underscores for your username.");
  validatePassword(body.password);
  return { username, password: body.password, name: text(body.name || username, 100, true) };
}
export async function accountRoute(request: Request, env: Env, user: Identity | null, path: string): Promise<Response | null> {
  const method = request.method;
  if (path === "/api/setup" && method === "POST") {
    await rateLimit(request, env, "setup", 10, 900);
    const body = await bodyOf(request);
    assert(typeof body.token === "string" && await secretMatches(body.token, env.SETUP_TOKEN), "Invalid setup credential.", 403);
    const { username, password, name } = credentials(body);
    const id = crypto.randomUUID(), recoveryCode = token();
    const result = await env.DB.prepare(`INSERT INTO users(id,username,name,role,password_hash,recovery_hash)
      SELECT ?,?,?,'owner',?,? WHERE NOT EXISTS(SELECT 1 FROM users) RETURNING id`)
      .bind(id, username, name, await hashPassword(password), await sha256(recoveryCode)).all();
    assert(result.results.length, "This installation has already been claimed.", 409);
    return json({ recoveryCode }, { status: 201, headers: { "set-cookie": await newSession(request, env, id) } });
  }
  if (path === "/api/login" && method === "POST") {
    await rateLimit(request, env, "password", 10, 900);
    const body = await bodyOf(request);
    const username = text(body.username, 64, true).toLowerCase();
    assert(typeof body.password === "string" && body.password.length <= 200, "Enter your password.");
    const password = body.password;
    const row = await env.DB.prepare("SELECT * FROM users WHERE username=? AND enabled=1").bind(username).first<UserRow>();
    // Match the cost for unknown names without caching plaintext or accepting defaults.
    const dummy = "pbkdf2-sha256$600000$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000";
    const valid = await verifyPassword(password, row?.password_hash || dummy);
    assert(row && valid, "Username or password isn't right.", 403);
    return json({ ok: true }, { headers: { "set-cookie": await newSession(request, env, row.id) } });
  }
  if (path === "/api/logout" && method === "POST") {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(cookie(request, "family_session"))).run();
    return json({ ok: true }, { headers: { "set-cookie": sessionCookie(request, env, "family_session", "", 0) } });
  }
  if (path === "/api/join" && method === "POST") {
    await rateLimit(request, env, "join", 10, 900);
    const body = await bodyOf(request), details = credentials(body);
    assert(typeof body.token === "string" && body.token.length <= 200, "Invalid invitation.");
    const hash = await sha256(body.token);
    const invitation = await env.DB.prepare("SELECT id,role,target_id FROM invitations WHERE token_hash=? AND expires>? AND used_by IS NULL").bind(hash, now()).first<{ id: string; role: string; target_id: string | null }>();
    assert(invitation, "This invitation has expired or has already been used.", 403);
    const id = invitation.target_id || crypto.randomUUID(), operation = token(), passwordHash = await hashPassword(details.password);
    const guard = "EXISTS(SELECT 1 FROM invitations WHERE id=? AND used_by=?)";
    const statements = [env.DB.prepare("UPDATE invitations SET used_by=? WHERE id=? AND used_by IS NULL AND expires>? RETURNING id").bind(operation, invitation.id, now())];
    if (invitation.target_id) statements.push(env.DB.prepare(`UPDATE users SET password_hash=?,auth_version=auth_version+1 WHERE id=? AND ${guard}`).bind(passwordHash, id, invitation.id, operation));
    else statements.push(env.DB.prepare(`INSERT INTO users(id,username,name,role,password_hash) SELECT ?,?,?,?,? WHERE ${guard}`).bind(id, details.username, details.name, invitation.role, passwordHash, invitation.id, operation));
    const result = await env.DB.batch(statements);
    assert(result[0].results.length, "This invitation has already been used.", 409);
    return json({ ok: true }, { status: 201, headers: { "set-cookie": await newSession(request, env, id) } });
  }
  if (path === "/api/recover" && method === "POST") {
    await rateLimit(request, env, "recover", 5, 3600);
    const body = await bodyOf(request);
    validatePassword(body.password);
    assert(typeof body.code === "string" && body.code.length <= 200, "Enter your recovery code.");
    const next = token();
    const result = await env.DB.prepare("UPDATE users SET password_hash=?,recovery_hash=?,auth_version=auth_version+1 WHERE role='owner' AND recovery_hash=? RETURNING id")
      .bind(await hashPassword(body.password), await sha256(next), await sha256(body.code)).all<{ id: string }>();
    assert(result.results.length, "Recovery code isn't right.", 403);
    return json({ recoveryCode: next }, { headers: { "set-cookie": await newSession(request, env, result.results[0].id) } });
  }
  if (path === "/api/google/link" && method === "DELETE") {
    requireRole(user);
    await env.DB.prepare("DELETE FROM identities WHERE user_id=? AND provider='google'").bind(user.id).run();
    return json({ ok: true });
  }
  if (!/^\/api\/(users|invitations|automation|ownership)(\/|$)/.test(path)) return null;
  requireRole(user, "owner");
  assert(!user.automationId, "Manage accounts from your browser account.", 403);
  if (path === "/api/users" && method === "GET") return json((await env.DB.prepare(`SELECT ${publicUser} FROM users ORDER BY name`).all()).results);
  if (path === "/api/invitations" && method === "GET") return json((await env.DB.prepare("SELECT id,role,target_id,expires FROM invitations WHERE used_by IS NULL AND expires>? ORDER BY expires").bind(now()).all()).results);
  if (path === "/api/invitations" && method === "POST") {
    const body = await bodyOf(request);
    assert(body.role === "viewer" || body.role === "editor", "Choose viewer or editor access.");
    const targetId = body.targetId || null;
    if (targetId) assert(uuid(targetId) && await env.DB.prepare("SELECT id FROM users WHERE id=? AND role!='owner' AND enabled=1").bind(targetId).first(), "Choose an active relative's account.");
    const id = crypto.randomUUID(), secret = token(), expires = now() + 48 * 3600;
    await env.DB.prepare("INSERT INTO invitations(id,token_hash,role,target_id,expires,created_by) VALUES(?,?,?,?,?,?)").bind(id, await sha256(secret), body.role, targetId, expires, user.id).run();
    return json({ id, token: secret, expires }, { status: 201 });
  }
  const invitationId = path.match(/^\/api\/invitations\/([^/]+)$/)?.[1];
  if (invitationId && method === "DELETE") {
    await env.DB.prepare("DELETE FROM invitations WHERE id=?").bind(invitationId).run(); return json({ ok: true });
  }
  const userId = path.match(/^\/api\/users\/([^/]+)$/)?.[1];
  if (userId && method === "PATCH") {
    const body = await bodyOf(request);
    assert(uuid(userId) && (body.role === "viewer" || body.role === "editor") && typeof body.enabled === "boolean", "Choose a role and access status.");
    const changed = await env.DB.prepare("UPDATE users SET role=?,enabled=?,auth_version=auth_version+1 WHERE id=? AND role!='owner' RETURNING id").bind(body.role, Number(body.enabled), userId).all();
    assert(changed.results.length, "The owner cannot be changed here.", 409);
    return json({ ok: true });
  }
  if (path === "/api/ownership" && method === "POST") {
    const body = await bodyOf(request);
    const owner = await env.DB.prepare("SELECT password_hash FROM users WHERE id=?").bind(user.id).first<{ password_hash: string }>();
    assert(typeof body.password === "string" && owner && await verifyPassword(body.password, owner.password_hash), "Confirm your password.", 403);
    assert(uuid(body.userId) && body.userId !== user.id, "Choose another active account.");
    const next = await env.DB.prepare("SELECT id FROM users WHERE id=? AND enabled=1 AND role!='owner'").bind(body.userId).first();
    assert(next, "Choose another active account.");
    const recoveryCode = token();
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET role='editor',recovery_hash=NULL,auth_version=auth_version+1 WHERE id=? AND role='owner'").bind(user.id),
      env.DB.prepare("UPDATE users SET role='owner',recovery_hash=?,auth_version=auth_version+1 WHERE id=? AND enabled=1 AND NOT EXISTS(SELECT 1 FROM users WHERE role='owner')").bind(await sha256(recoveryCode), body.userId),
      env.DB.prepare("DELETE FROM automation_credentials"),
    ]);
    return json({ recoveryCode });
  }
  if (path === "/api/automation" && method === "GET") return json((await env.DB.prepare("SELECT id,name,created_at FROM automation_credentials ORDER BY created_at DESC").all()).results);
  if (path === "/api/automation" && method === "POST") {
    const body = await bodyOf(request), secret = token(), id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO automation_credentials(id,name,token_hash,user_id) VALUES(?,?,?,?)").bind(id, text(body.name, 100, true), await sha256(secret), user.id).run();
    return json({ id, token: secret }, { status: 201 });
  }
  const automationId = path.match(/^\/api\/automation\/([^/]+)$/)?.[1];
  if (automationId && method === "DELETE") {
    await env.DB.prepare("DELETE FROM automation_credentials WHERE id=?").bind(automationId).run(); return json({ ok: true });
  }
  return null;
}
