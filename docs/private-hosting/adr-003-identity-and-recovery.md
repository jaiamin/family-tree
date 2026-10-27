# ADR 003: Shared viewing and Google editing

Status: accepted; supersedes the initial named-password-account proposal.

Both deployments use one shared family password for visitors, with no viewer accounts. Compare the runtime secret through Web Crypto, rate-limit attempts, and issue random opaque HttpOnly sessions stored only as hashes. Password rotation invalidates viewer sessions. A shared password can be forwarded; it provides family privacy, not individual viewer accountability.

Only the configured owner and explicitly approved editor emails may authenticate through Google. Verify issuer, audience, expiry, email verification and a single-use nonce; bind the first verified Google subject and refuse reassignment. Editors have no local account password. Google sign-in requires internet; an existing local viewer session does not.

Owner identity comes from deployment configuration, never the first visitor. Changing the configured owner invalidates old owner authorization, including automation. The installer recovers access by changing that configuration. Editor logout preserves the independently authenticated viewer session; viewer logout revokes both.

This avoids costly per-account password hashing on Cloudflare Free and gives older relatives one familiar password screen. There is no alternative local-password authentication mode, signup, invitation/reset links or runtime legacy fallback. Secrets remain installer-managed; verified existing editor approvals migrate without inventing provider subject identities.
