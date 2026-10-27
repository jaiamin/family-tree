# Working on Family Tree

## Structure
- `web/src`: Cloudflare Worker, authentication, D1/R2 storage, browser forms.
- `web/ui`: graph layout, tree viewer, search, relationship comparison.
- `mcp/src`: local Python MCP client for the hosted API.
- `web/schema.sql`: database schema. `docs/operations.md`: hosting and recovery.

## Development
- Keep changes focused; preserve the graph layout unless the task requires changing it.
- Use Node.js 26, pnpm (lockfile), Python 3.10+, and uv. Avoid new dependencies without a concrete need.
- Install with `pnpm --dir web install --frozen-lockfile` and `uv sync --locked`.
- Build before type checking: `pnpm --dir web build && pnpm --dir web check && pnpm --dir web test`.
- Python checks: `uv run ruff format --check . && uv run ruff check . && uv run ty check && uv run pytest`.
- For production build changes, run `pnpm --dir web exec vite build` and `pnpm --dir web exec cf deploy --prebuilt --mode production --dry-run`.
- Preview: `pnpm --dir web dev`, port 8000, `/family-tree/`. Local-only password: `local-preview-only`.
- Verify UI changes in a browser on desktop and mobile, including relevant scroll and error states.

## Data and access
- Production D1 is authoritative. Local preview data in `web/.local` is separate; never deploy it or re-import it over live data.
- Reuse stable person UUIDs across trees. Preserve revision checks and server-side role enforcement.
- Members view, suggest, and add/replace photos; editors edit people/relationships, review suggestions, and clear photos; owner alone manages access/trees and permanently deletes people.
- Keep every immutable photo upload and its backup copy, including after replacement or person deletion. Never prune them as cleanup.
- The rolling backup is disaster recovery, not undo history. Treat schema changes as explicit migrations; do not reapply/import a database during deployment.
- Never print or commit credentials or family data. Keep secrets in their existing runtime settings; use placeholders in configuration examples.

## Delivery
- Work through a task branch and PR. Do not push to `main`, merge, or bypass required checks without explicit authorization.
- CI must pass: `mcp (3.10)`, `mcp (3.14)`, `web`, and `secrets`. Stop publication if secret scanning reports a finding; report the file/rule without the secret.
- Merging into `main` triggers Cloudflare Workers Builds (`web` root). CI checks do not deploy. Do not manually deploy or change production resources unless authorized.
- Keep README concise; put operational detail in `docs/operations.md`. Report verification and anything requiring owner action.
