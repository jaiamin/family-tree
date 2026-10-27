# Installation and recovery

One installation contains one shared collection, any number of tree groupings, and one owner. Access applies to every tree. Editor accounts are separate from genealogical people. Visitors share a family password; they do not need Google accounts. Never expose database files or photo/backup storage publicly.

## Local production

Requires Docker Compose and an HTTPS reverse proxy forwarding the configured path to localhost:8000. Viewing and existing viewer sessions work without internet on a reachable local server. Editor Google sign-in requires internet.

1. Copy `.env.example` to ignored `.env`. Set your HTTPS `PUBLIC_ORIGIN`, `BASE_PATH`, a strong `FAMILY_PASSWORD`, your `OWNER_EMAIL` and `GOOGLE_CLIENT_ID`, and an absolute private `BACKUP_DIRECTORY`. The backup folder must be writable by container UID 1000; choose a separate device if possible. A second path on the same disk is not off-device protection.
2. Initialize **fresh** storage and start:

   ```sh
   docker compose build
   docker compose run --rm family-tree node scripts/maintain.mjs init
   docker compose up -d
   ```

3. Configure your HTTPS proxy to forward the app path and append the actual client address to `X-Forwarded-For`. Set `TRUST_PROXY_HOPS=1` for one trusted proxy (or the exact number of controlled proxy hops, up to 9). Keep port 8000 private: forwarded headers are trusted only when explicitly configured, so bypassing the proxy must be impossible. The default `0` ignores forwarding and shares abuse limits among clients of the same socket peer.
4. Visit the HTTPS app URL. Enter the family password, then choose **Edit** from the menu and sign in with the configured owner Google account. Create a tree and its first person. Approve relatives under **Editor access**; viewers need only the family password.

The process runs unprivileged with private persistent data/backup mounts. Do not run `init` against an existing installation or remove its volumes. Changing `BASE_PATH` requires rebuilding the image as well as changing runtime configuration. Startup rejects a frontend/runtime path mismatch; builds reject a conflicting Cloudflare installation path. Back up before upgrading; retain the previous image until verified.

## Cloudflare production

Cloudflare Free supports this design within its request, CPU, D1 and R2 usage limits. A shared runtime secret is compared with Web Crypto; there are no per-account password hashes. Google verifies editor credentials.

Create a fresh D1 database and two private R2 buckets. Copy `web/installation.example.json` to ignored `web/installation.json`; fill in your own account/resource IDs, origin, base path, name, owner email and Google client ID. Alternatively set build variable `FAMILY_INSTALLATION_CONFIG_JSON` to that JSON. `FAMILY_INSTALLATION_CONFIG` selects an explicit configuration file and takes precedence. No personal resources or owner emails are built in.

Use an existing resource-scoped `CLOUDFLARE_API_TOKEN` in your operator environment; never put it in commands, source or logs. Initialize with `DEPLOYMENT=cloudflare pnpm --dir web maintain init`. Configure the Worker `FAMILY_PASSWORD` secret interactively/in the dashboard; build and deploy with `pnpm --dir web deploy`. Enter the family password, then use **Edit** to sign in with the configured owner Google account. Deployment updates code, never imports family data or initializes a database.

For GitHub-connected Workers Builds: root `web`, Node 26, branch `main`, build `pnpm build && pnpm exec vite build`, deploy `pnpm exec cf deploy --prebuilt --mode production`. Provide the installation JSON as a **build** variable. CI uses example IDs and does not deploy. Never attach preview deployments to live storage. Schema-changing releases require the explicit procedure below before deployment; an incompatible schema returns 503.

Configure your reverse proxy/custom domain to forward the base path and all descendants without intercepting tree routes. `PUBLIC_ORIGIN` must be the exact HTTPS browser origin, without a path. Shared links remain private after sign-in. Create a Google OAuth **Web application** client and register the exact browser origin as an authorized JavaScript origin (include `http://localhost:8000` for development if needed). Publish its consent screen or list approved editors as test users while in testing. Configure its client ID on either deployment. Only the configured owner and approved editor emails may sign in. Their first verified Google login binds the stable Google subject; an email change cannot silently replace it.

## Upgrades and the existing installation

Schema2 is the shared-viewer/Google-editor baseline. The one-time pre-baseline conversion is `migrate-legacy`; there is no old authentication mode or automatic schema migration. Keep the existing production bindings/code intact until rehearsal and cutover are explicitly approved.

- **Current installations:** pause → preflight → update code → verify → resume. Local commands: `docker compose exec family-tree node scripts/maintain.mjs pause` (then `preflight` or `resume`). Operator commands can also run with `DEPLOYMENT=cloudflare pnpm --dir web maintain <command>`. Pause is enforced in SQL, including writes already in flight. Preflight requires schema 2 and maintenance mode, verifies retained backup photo hashes, and replaces the previous pre-upgrade point only after verification. Future schema releases must ship a numbered conversion and tests; unsupported versions stop instead of guessing.
- **Legacy conversion:** stop writes to the old installation, provision a **fresh** schema 2 destination, and run a rehearsal. For local storage set destination `DATA_DIR`/`BACKUP_DIR` plus `LEGACY_DATA_DIR`/`LEGACY_BACKUP_DIR`; run `pnpm --dir web maintain migrate-legacy`. For Cloudflare set destination configuration plus `LEGACY_INSTALLATION_CONFIG` pointing to the source configuration; run `DEPLOYMENT=cloudflare pnpm --dir web maintain migrate-legacy`. Both sources are read-only. Destination backup storage must also be empty.
- Conversion checks source fingerprints before/after; verifies primary and backup bytes for every retained photo; preserves genealogy, memberships, UUIDs and short IDs; restores into fresh storage. It does not carry over secrets, sessions, API tokens or inferred Google identities. Previous approved editor emails retain their approval and bind a Google subject on first verified sign-in. Configure the family password and owner email separately.
- Compare counts, shared memberships, links, current photos and retained uploads; verify viewer/editor/owner permissions and recovery. Only then change production bindings/configuration and deploy. Keep the verified source offline until cutover is confirmed; deleting it is a separate decision. Never import a development fixture over production.

Code-only releases can deploy automatically. Do not merge a schema-changing release into an automatically deploying production branch until its installation configuration and reviewed migration procedure are ready.

## Backups and photos

Each accepted photo is immutable, keyed by person UUID/upload UUID, and written to primary **and** backup storage before its database pointer advances. Replacement and displayed-photo removal keep every upload, including after person deletion. Browser uploads are square crops, not original camera files.

Successful mutations refresh the latest consistent manifest asynchronously; a 15-minute schedule retries and creates daily points. Retain latest state, seven daily points, and one verified pre-upgrade point. Photos are reused across snapshots. The owner's **Backups** view shows last success, pending changes and failures. Local `BACKUP_DIR`/Compose `BACKUP_DIRECTORY` selects the second destination. Protect both; loss of the host/account can still destroy both copies.

The owner can export an AES-256-GCM encrypted archive in **Backups**. Save its recovery key separately; losing the key makes the export unrecoverable. Local/operator `maintain export` requires `EXPORT_FILE` and a **new** `RECOVERY_KEY_FILE` and writes private files without printing keys. Move one copy off-device. GEDCOM is only genealogy interchange; it is not complete recovery.

## Restore / lost owner access

Restore always targets a **fresh initialized database**, primary storage and empty backup staging destination. Set `EXPORT_FILE` and `RECOVERY_KEY_FILE`; run `maintain restore` (same local/Cloudflare selector as above). The tool authenticates/decrypts records, validates manifest/collection consistency, verifies all photo hashes, copies retained bytes, and restores rows atomically. It excludes sessions and automation credentials. Enter the family password and sign in to Google again; recreate MCP credentials separately. Interrupted photo copying leaves the database empty; an interrupted encrypted staging requires a new empty staging destination. Do not delete an uncertain destination to retry.

To recover a daily/pre-upgrade point instead, use maintenance-only `recoverBackup(env, key)` with fresh DB/primary bindings and the existing backup binding; keys are `daily/YYYY-MM-DD.json` or `pre-upgrade.json`. It never writes to the source backup. The encrypted CLI restores `collection.json`.

The installer recovers ownership by updating `OWNER_EMAIL` in the installation configuration (Docker environment or Cloudflare build JSON) and redeploying. The previous owner immediately loses owner API/session/token access; signing in as the new owner disables the old owner account. No recovery code or second password is required. To revoke viewing sessions, rotate `FAMILY_PASSWORD` in runtime secrets and restart/redeploy. Editors sign out to viewer mode first; viewer sign-out then closes family access. Approval revocation immediately blocks editor actions without interrupting an existing viewer session.

## Checks

`pnpm --dir web build && pnpm --dir web check && pnpm --dir web test`; browser checks: `pnpm --dir web test:browser`; offline image/restore/restart check: `node web/tests/docker-smoke.mjs`. For Cloudflare build verification set `FAMILY_INSTALLATION_CONFIG=installation.example.json`, then run Vite build and `cf deploy --prebuilt --mode production --dry-run` from `web`. Run a restore drill before relying on a new installation. No zero-loss guarantee is implied by a successful backup job.
