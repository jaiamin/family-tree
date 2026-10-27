# Setup and recovery

One installation has one owner and shared access across all trees. Keep databases, photos and backups private. [Roles](../README.md#host-your-own) · [Architecture](private-hosting/adr-002-two-deployments-one-application.md)

## Docker

Requires Docker Compose. Remote access needs an HTTPS reverse proxy; local viewing works offline after setup. New Google sign-in requires internet.

1. Copy `.env.example` to ignored `.env`. Set the HTTPS browser `PUBLIC_ORIGIN` (no path), `BASE_PATH`, strong `FAMILY_PASSWORD`, `OWNER_EMAIL`, `GOOGLE_CLIENT_ID` and absolute `BACKUP_DIRECTORY`.
2. Make the private backup directory writable by container UID 1000, preferably on a separate device. Initialize **fresh** storage:

   ```sh
   docker compose build
   docker compose run --rm family-tree node scripts/maintain.mjs init
   docker compose up -d
   ```

3. Proxy the base path **and descendants** to localhost:8000. Keep that port private. Append the actual client address to `X-Forwarded-For`; set `TRUST_PROXY_HOPS` to the number of controlled proxies (1–9). Default `0` ignores forwarding and shares rate limits by socket peer. Never permit bypassing a trusted proxy.
4. Complete [first sign-in](#google-and-first-sign-in).

Persistent data and backups use separate mounts; the process runs unprivileged. Never initialize existing storage or remove its volumes. Changing `BASE_PATH` requires an image rebuild and matching runtime configuration; startup rejects mismatches.

## Cloudflare

Works on Free within request, CPU, D1 and R2 limits. Authentication uses a shared runtime secret and Google verification, without per-account password hashing.

1. Create a Worker, fresh D1 database and two private R2 buckets. Set the Worker's `FAMILY_PASSWORD` runtime secret in the dashboard.
2. Copy `web/installation.example.json` to ignored `web/installation.json`; fill every field with your resources and settings. Alternatively supply build variable `FAMILY_INSTALLATION_CONFIG_JSON`. `FAMILY_INSTALLATION_CONFIG` selects a file and takes precedence.
3. Authenticate through the operator environment's resource-scoped `CLOUDFLARE_API_TOKEN`, then:

   ```sh
   pnpm --dir web install --frozen-lockfile
   pnpm --dir web build
   DEPLOYMENT=cloudflare pnpm --dir web maintain init
   pnpm --dir web run deploy
   ```

4. Proxy the base path and descendants to the Worker. Set `PUBLIC_ORIGIN` to the exact HTTPS browser origin, without a path. Complete first sign-in below.

Never initialize populated storage or bind previews to live resources. Deployment updates code, not family data. Incompatible schemas return 503.

For GitHub-connected Workers Builds:

| Setting | Value |
|---|---|
| Root / production branch | `web` / `main` |
| Node | 26 |
| Build | `pnpm build && pnpm exec vite build` |
| Deploy | `pnpm exec cf deploy --prebuilt --mode production` |
| Build variable | `FAMILY_INSTALLATION_CONFIG_JSON` |
| Runtime secret | `FAMILY_PASSWORD` |

CI uses example resources and never deploys. Both deployments require matching build/runtime base paths.

## Google and first sign-in

Create a Google OAuth **Web application** client. Authorize the exact browser origin; use `http://localhost:8000` for development. Publish the consent screen or add approved editors as test users.

Enter the family password, choose **Edit** in the menu and sign in as the configured owner. Create a tree/person and approve editors under **Editor access**. Visitors need only the family password. The first verified login binds each approved editor's Google subject; an email change cannot reassign it.

## Maintenance commands

Build before running operator commands. Use one prefix:

| Host | Prefix |
|---|---|
| Docker, running container | `docker compose exec family-tree node scripts/maintain.mjs` |
| Cloudflare, repository root | `DEPLOYMENT=cloudflare pnpm --dir web maintain` |

Append `pause`, `preflight`, `resume`, `export` or `restore`. `init` is only for fresh storage.

## Upgrades

Code-only releases may deploy automatically. For schema changes, prepare and review the migration **before** merging into an automatically deploying branch.

- Current schema: **2**. Pause → preflight → update code → verify → resume. SQL enforces maintenance mode, including in-flight writes. Preflight verifies backup photo hashes before replacing the pre-upgrade point. Retain the previous image until verification.
- Pre-baseline conversion: freeze the source; provision fresh destination database/primary/backup storage; rehearse `migrate-legacy`. Local operator environment: destination `DATA_DIR`/`BACKUP_DIR` and source `LEGACY_DATA_DIR`/`LEGACY_BACKUP_DIR`. Cloudflare: destination installation configuration and source `LEGACY_INSTALLATION_CONFIG`.
- Conversion reads sources without modifying them, checks fingerprints and retained photo bytes, and preserves genealogy, memberships, UUIDs, public IDs and editor approvals. Configure owner/password separately; sessions, tokens and Google subject identities are not inferred or migrated.
- Verify counts, memberships, links, photos, permissions and recovery before switching bindings/configuration. Keep the source offline until accepted. Deletion requires a separate decision.

Future schema changes require numbered, tested conversions. Never reseed production, import preview fixtures or rely on runtime legacy fallbacks.

## Backups and photos

Accepted photos are immutable, keyed by person/upload UUID, and written to primary **and** backup before changing the display pointer. Replacement, displayed-photo removal and person deletion retain all uploads. Browser uploads are square crops, not original camera files.

Mutations asynchronously refresh the latest consistent manifest. A 15-minute schedule retries and creates daily points. Retention: latest state, seven daily points and one verified pre-upgrade point; snapshots share retained photos. **Backups** shows freshness, pending changes and failures. Two folders on one disk—or two buckets in one account—do not protect against losing that disk/account.

The owner can export an AES-256-GCM encrypted archive. Save its recovery key separately and keep an off-device copy. Operator `export` requires `EXPORT_FILE` and a **new** `RECOVERY_KEY_FILE`; it creates private files without printing keys. Lost keys make exports unrecoverable. GEDCOM is not a full backup.

## Restore and access recovery

Target a **fresh initialized database**, primary storage and empty backup staging. Set `EXPORT_FILE` and `RECOVERY_KEY_FILE`, then run `restore`. It authenticates the archive, validates consistency and photo hashes, copies uploads and restores rows atomically. Sessions/tokens are excluded: sign in again and recreate MCP credentials.

Interrupted photo copying leaves the database empty. Interrupted encrypted staging requires new empty staging; never delete an uncertain destination just to retry. For daily/pre-upgrade recovery, maintenance-only `recoverBackup(env, key)` takes fresh database/primary bindings and a read-only source backup (`daily/YYYY-MM-DD.json` or `pre-upgrade.json`). Encrypted CLI recovery uses `collection.json`.

| Need | Action |
|---|---|
| Recover ownership | Change `OWNER_EMAIL` in Docker environment or Cloudflare build configuration; redeploy. Previous owner authority, including tokens, ends; new-owner login disables the old account. |
| Revoke viewing sessions | Rotate `FAMILY_PASSWORD`; restart/redeploy. |
| Revoke editing | Remove editor approval; existing viewer access remains. |
| Sign out | Editor logout returns to viewing; viewer logout closes both sessions. |

Run a restore drill before relying on an installation. Backups reduce risk; successful jobs do not guarantee zero data loss. See [development checks](../AGENTS.md#development).
