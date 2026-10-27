import type { Env, Identity } from "./types";
import type { Statement } from "./platform/storage";
export function activityStatements(env: Env, user: Identity, action: string, target: string | null = null) {
  return [
    env.DB.prepare("INSERT INTO activity(actor_id,actor_name,action,target) VALUES(?,?,?,?)").bind(user.automationId || user.id, user.name, action, target),
    env.DB.prepare("DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY id DESC LIMIT 1000)"),
  ];
}
export function audited(env: Env, user: Identity, action: string, statements: Statement[], target: string | null = null) {
  return env.DB.batch([...statements, ...activityStatements(env, user, action, target)]);
}
