# Family Tree

A private family-tree app for one family installation. Browse graphs or a list, search, compare relationships, share private links, and contribute photos. People and photos are shared across named trees.

| Access | Can do |
|---|---|
| Viewer | Browse, suggest corrections, add/replace photos |
| Editor | Also edit people/relationships, review suggestions, clear displayed photos |
| Owner | Also manage trees/accounts/settings, import GEDCOM, delete people, transfer ownership |

Invite-only username/password accounts work offline. Google sign-in is optional and explicitly linked. Source code is public; records and images require authentication.

## Run your own

Choose **Docker + SQLite/private files** or **Cloudflare Workers + D1/private R2**. Start with [setup, upgrades and recovery](docs/operations.md). Each installation has independent data and access; this is not a public signup service.

## Develop

Requires Node.js 26 and pnpm 12.15.0.

```sh
pnpm --dir web install --frozen-lockfile
pnpm --dir web build
pnpm --dir web dev
```

Open **http://localhost:8000/family-tree/** (sandbox forwarding: 8000 → 8000). Claim the empty development installation with `local-setup-only`, then choose your own owner credentials. Preview data stays in ignored `web/.local/`; it never replaces production.

```sh
pnpm --dir web check
pnpm --dir web test
pnpm --dir web exec playwright install chromium
pnpm --dir web test:browser
node web/tests/docker-smoke.mjs
```

## MCP (optional)

With Python 3.10+ and [uv](https://docs.astral.sh/uv/), run `uv run family-tree-mcp`. Set `FAMILY_TREE_URL` to your app's base URL and `FAMILY_TREE_TOKEN` through your client's secret settings. The owner creates/revokes individual credentials under **Agent access**. MCP edits the same authoritative API; there is no publish/export step. Search before creating people; reuse their stable IDs across trees.

Python checks: `uv sync --locked`, then `uv run ruff format --check .`, `uv run ruff check .`, `uv run ty check`, `uv run pytest`.

Code: `web/src` shared domain/API/auth, `web/src/platform` storage implementations, `web/ui` viewer/layout, `mcp/src` local MCP client. [Architecture decisions](docs/private-hosting/adr-002-two-deployments-one-application.md).

[MIT](LICENSE) · [ELK.js](web/ui/vendor/README.md) · [Geist (OFL)](https://github.com/vercel/geist-font/blob/main/LICENSE)
