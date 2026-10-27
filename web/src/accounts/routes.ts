import { audited } from "../activity";
import { assert, uuid } from "../model";
import { bodyOf, text } from "../http";
import { cookie, newViewerSession, rateLimit, requireRole, secretMatches, sessionCookie, sha256 } from "../auth";
import type { Env, Identity } from "../types";

const token = () => crypto.randomUUID() + crypto.randomUUID();
const json = Response.json;
export async function accountRoute(request: Request, env: Env, user: Identity | null, path: string): Promise<Response | null> {
  const method = request.method;
  if (path === "/api/login" && method === "POST") {
    const attempt = await rateLimit(request, env, "password", 10, 900);
    const body = await bodyOf(request);
    assert(env.FAMILY_PASSWORD, "The family password hasn't been configured.", 503);
    assert(typeof body.password === "string" && body.password.length <= 200 && await secretMatches(body.password,env.FAMILY_PASSWORD), "The password isn't right.", 403);
    await env.DB.prepare("DELETE FROM rate_limits WHERE key=?").bind(attempt).run();
    return json({ ok:true }, { headers: { "set-cookie": await newViewerSession(request,env) } });
  }
  if ((path === "/api/logout" || path === "/api/logout/editing") && method === "POST") {
    const names = path.endsWith("/editing") ? ["family_session"] : ["family_session","family_viewer"];
    const headers = new Headers();
    await env.DB.batch(await Promise.all(names.map(async name => env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(cookie(request,name))))));
    for (const name of names) headers.append("set-cookie",sessionCookie(request,env,name,"",0));
    return json({ok:true},{headers});
  }
  if (!/^\/api\/(users|automation)(\/|$)/.test(path)) return null;
  requireRole(user,"owner");
  assert(!user.automationId,"Manage access from your browser account.",403);
  if (path === "/api/users" && method === "GET") return json((await env.DB.prepare("SELECT id,name,email,role,enabled,created_at FROM users ORDER BY name").all()).results);
  if (path === "/api/users" && method === "POST") {
    const body = await bodyOf(request), email = text(body.email,254,true).toLowerCase();
    assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),"Enter a valid Google email address.");
    assert(email !== env.OWNER_EMAIL?.toLowerCase(),"The owner already has access.",409);
    const id = crypto.randomUUID();
    await audited(env,user,"editor.approved",[env.DB.prepare("INSERT INTO users(id,email,name,role) VALUES(?,?,?,'editor')").bind(id,email,email)],id);
    return json({id},{status:201});
  }
  const userId = path.match(/^\/api\/users\/([^/]+)$/)?.[1];
  if (userId && method === "PATCH") {
    const body = await bodyOf(request);
    assert(uuid(userId) && typeof body.enabled === "boolean","Choose an access status.");
    const [changed] = await audited(env,user,"editor.access_changed",[env.DB.prepare("UPDATE users SET enabled=?,auth_version=auth_version+1 WHERE id=? AND role='editor' RETURNING id").bind(Number(body.enabled),userId)],userId);
    assert(changed.results.length,"The owner cannot be changed here.",409);
    return json({ok:true});
  }
  if (path === "/api/automation" && method === "GET") return json((await env.DB.prepare("SELECT id,name,created_at FROM automation_credentials ORDER BY created_at DESC").all()).results);
  if (path === "/api/automation" && method === "POST") {
    const body = await bodyOf(request), secret = token(), id = crypto.randomUUID();
    await audited(env,user,"agent.created",[env.DB.prepare("INSERT INTO automation_credentials(id,name,token_hash,user_id) VALUES(?,?,?,?)").bind(id, text(body.name, 100, true), await sha256(secret), user.id)],id);
    return json({ id, token: secret }, { status: 201 });
  }
  const automationId = path.match(/^\/api\/automation\/([^/]+)$/)?.[1];
  if (automationId && method === "DELETE") {
    await audited(env,user,"agent.revoked",[env.DB.prepare("DELETE FROM automation_credentials WHERE id=?").bind(automationId)],automationId); return json({ ok: true });
  }
  return null;
}
