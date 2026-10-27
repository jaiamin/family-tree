# Working on Family Tree

## Structure

| Path | Responsibility |
|---|---|
| `web/src/app.ts` | Shared API, authentication and domain |
| `web/src/platform` | Cloudflare/local storage adapters |
| `web/src/index.ts`, `web/scripts/server.mjs` | Worker/Node entry points |
| `web/ui` | Viewer, layout, search and comparison |
| `web/schema.sql` | Database schema |
| `mcp/src` | Optional Python API client |
| `docs/operations.md` | Hosting, upgrades and recovery |

## Development

Preserve graph layout unless requested. Use Node.js 26, pnpm's lockfile, Python 3.10+ and uv; add dependencies only when needed.

```sh
pnpm --dir web install --frozen-lockfile
pnpm --dir web build
pnpm --dir web check
pnpm --dir web test
uv sync --locked
uv run ruff format --check .
uv run ruff check .
uv run ty check
uv run pytest
```

Browser checks: `pnpm --dir web exec playwright install chromium`, then `pnpm --dir web test:browser`. Docker checks: `node web/tests/docker-smoke.mjs`. Verify UI flows on desktop/mobile, including scrolling and errors.

For production-build changes, set `FAMILY_INSTALLATION_CONFIG=installation.example.json`; run `pnpm --dir web exec vite build` and `pnpm --dir web exec cf deploy --prebuilt --mode production --dry-run`.

Preview: `pnpm --dir web dev`, port 8000, `/family-tree/`, password `local-preview-only`. Editing needs configured Google credentials; viewers have no accounts.

## Data and access

- The configured production database is authoritative. Never deploy/import `web/.local` preview data over it.
- Reuse person UUIDs across trees; preserve revision checks and server-side permissions.
- Viewers suggest and add/replace photos; editors also edit genealogy, review suggestions and clear photos. Only the owner manages access/trees and permanently deletes people.
- Retain every immutable upload and backup copy, even after replacement/person deletion. Never prune as cleanup.
- Backups are recovery, not undo. Migrate schemas explicitly; never reinitialize/import a database during deployment.
- Never print/commit credentials or family data. Use runtime secrets and placeholder examples.

## Delivery

- Task branch and PR only; no main pushes, merges, bypassed checks or production changes without authorization.
- Append `Co-authored-by: Codex <noreply@openai.com>` once to Codex-authored commits; preserve trailers. Never rewrite history solely for attribution.
- Required CI: `mcp (3.10)`, `mcp (3.14)`, `web`, `local`, `secrets`. Secret-scanner findings stop publication; report file/rule without the secret.
- Main merges trigger Cloudflare Workers Builds (`web` root); CI never deploys.
- Keep README concise; operational detail belongs in `docs/operations.md`. Report verification and required owner actions.
