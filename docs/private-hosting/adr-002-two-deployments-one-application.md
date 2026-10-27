# ADR 002: Two explicit deployments, one application

Status: implemented.

Keep one domain model, permission policy, HTTP behavior and viewer. Support Cloudflare Worker/D1/private R2 and a real local production server/SQLite/private filesystem implementation. Do not market the Miniflare development preview as production or emulate all D1/R2 methods.

Expose narrow transaction, private blob, scheduled-work and trusted-request interfaces. Test both implementations against identical correctness/security contracts. Docker Compose packages local production with persistent storage. The local server uses Node26 HTTP/SQLite; narrow SQL and blob contracts keep domain operations shared. Both implementations pass the same access, conflict, backup and recovery tests, including encrypted Cloudflare→local and local→Cloudflare transfers. `app.ts` accepts only shared storage and background-work contracts; Worker and Node entry points supply trusted client addresses and lifecycle handling. No deployment branch belongs in the viewer or MCP.

Local core operations work offline after setup, including password authentication, editing and uploads. Bundle required assets; Google is optional. Remote use requires an always-on reachable HTTPS endpoint; a tunnel is optional and never an authentication substitute. No silent storage/runtime failover or compatibility modes.
