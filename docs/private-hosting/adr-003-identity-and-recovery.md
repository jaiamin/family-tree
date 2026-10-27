# ADR 003: Shared viewing, Google editing

Visitors use one shared password; approved editors and the configured owner use Google. No viewer accounts or local account passwords. This keeps family access simple and avoids per-account password hashing on Cloudflare Free.

Rate-limit password attempts. Store only hashes of random HttpOnly session tokens; password rotation invalidates viewer sessions. Verify Google issuer, audience, expiry, verified email and single-use nonce. Bind the first approved Google subject; refuse reassignment.

Deployment configuration determines ownership and recovery. Editor logout preserves viewing; viewer logout revokes both. A shared password can be forwarded and provides no individual viewer accountability. See [recovery](../operations.md#restore-and-access-recovery).
