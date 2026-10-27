# Family Tree

Private family trees. Graph and list views, photos, search, relationship comparison, private sharing and GEDCOM import/export.

## Deploy

Same app and frontend, two hosting options. [Setup & recovery →](docs/operations.md)

| | Docker | Cloudflare |
|---|---|---|
| Runtime | Node.js | Workers Free¹ |
| Data | SQLite + private files | D1 + private R2 |
| Setup | `.env.example` → `.env` | `web/installation.example.json` → `web/installation.json` |


Follow [Docker setup](docs/operations.md#local-production) or [Cloudflare setup](docs/operations.md#cloudflare-production), share the family password, then approve editors. Encrypted backups transfer installations between hosts.

| Role | Access |
|---|---|
| Viewer | Browse, suggest corrections, add/replace photos |
| Editor | Also edit people/relationships, review suggestions, clear displayed photos |
| Owner | Also manage trees/editor access, import, delete people |

Visitors use one family password; approved editors use Google. Public source code; private family data.

¹ Free-plan usage limits apply. No paid plan is required by the authentication design.

## Optional MCP

Requires Python 3.10+ and [uv](https://docs.astral.sh/uv/). Create a credential under **Agent access**, configure your MCP client, then run `uv run family-tree-mcp`:

| Environment | Value |
|---|---|
| `FAMILY_TREE_URL` | Your app URL including its base path, e.g. `https://family.example.com/family-tree` |
| `FAMILY_TREE_TOKEN` | Credential from Agent access; store in client secrets |

Same setup for either host. Edits save directly. Search before adding people; reuse stable IDs across trees.

## Develop

Node.js 26.12.1+, pnpm 12.15.0; Docker for production-image tests.

```sh
pnpm --dir web install --frozen-lockfile
pnpm --dir web build
pnpm --dir web dev
```

Open **http://localhost:8000/family-tree/** (forward 8000 → 8000). Use password `local-preview-only`. Ignored preview data never replaces production. For editing, set `GOOGLE_CLIENT_ID` and `OWNER_EMAIL`; authorize the localhost origin in Google.

```sh
pnpm --dir web check && pnpm --dir web test
pnpm --dir web exec playwright install chromium
pnpm --dir web test:browser
node web/tests/docker-smoke.mjs
uv sync --locked
uv run ruff format --check . && uv run ruff check . && uv run ty check && uv run pytest
```

Code: `web/src/app.ts` shared app; `web/src/platform` storage; `web/src/index.ts` / `web/scripts/server.mjs` runtime entry points; `web/ui` viewer; `mcp/src` optional client.

[Operations](docs/operations.md) · [Architecture](docs/private-hosting/adr-002-two-deployments-one-application.md) · [MIT](LICENSE) · [ELK.js](web/ui/vendor/README.md) · [Geist (OFL)](https://github.com/vercel/geist-font/blob/main/LICENSE)
