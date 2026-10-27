# ADR 003: Invited local accounts with offline recovery

Status: implemented.

Final interview decisions: one owner with explicit transfer and protection against removing the last owner. Local credentials remain the offline-capable foundation; optional Google linking does not create a parallel permission model.

Owner-issued single-use expiring invitation links let relatives establish usernames/passwords without SMTP. Store adaptive salted password verifiers. Bootstrap requires an installer-generated single-use claim credential; public first-visitor ownership is forbidden.

Opaque browser sessions and individually revocable automation credentials map to application users/authority and are enforced server-side. Optional Google links require explicit approved-account linking and provider/sub identity, never automatic email matching. Recovery uses a saved code or host-side command without resetting genealogy, with affected sessions invalidated.

Migration retires shared-password access and establishes credentials for approved existing owners/editors. Existing emails express approval intent, not trusted Google subject identities. Pending accounts do not become public registration. Invitations/recovery secrets must not enter logs or third-party scripts. Passwords use salted PBKDF2-SHA256 (600,000 rounds); browser sessions use HttpOnly cookies and stored token hashes. Invitation secrets travel in URL fragments, then are removed before use.
