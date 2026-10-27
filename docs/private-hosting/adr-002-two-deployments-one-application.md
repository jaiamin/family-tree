# ADR 002: Two deployments, one application

Share the domain model, permissions, HTTP API and frontend. Cloudflare supplies Workers/D1/private R2; Docker supplies Node.js/SQLite/private files. Runtime entry points provide storage, background work and trusted client addresses through narrow contracts. The viewer and optional MCP contain no deployment branches.

Test both adapters against the same access, revision-conflict and recovery contracts, including encrypted transfers between hosts. Miniflare is development-only; there is no silent failover or compatibility store.

Local viewing, password entry and uploads work offline after setup; new Google sign-in needs internet. Remote access requires reachable HTTPS. See [setup](../operations.md).
