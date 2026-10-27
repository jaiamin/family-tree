import app from "./app";
import type { Env } from "./types";

// Native bindings satisfy the shared storage contracts. Only Worker lifecycle
// and trusted client addressing belong here; the application is runtime-neutral.
export default {
  fetch(request, env, ctx) {
    return app.fetch(request, { ...env, CLIENT_IP: request.headers.get("cf-connecting-ip") || "unknown" }, ctx);
  },
  scheduled(_controller, env, ctx) { return app.backup(env, ctx); },
} satisfies ExportedHandler<Env>;
