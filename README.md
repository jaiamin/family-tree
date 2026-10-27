# Family tree

A private family website with shared people across trees, photos, search, two graph layouts, relationship comparison, and person/tree links. A local MCP client supports larger edits against the same hosted data.

- **Family password:** view, upload/replace photos, send private suggestions.
- **Approved Google editors:** edit details, add relatives, connect existing people, remove displayed photos, review suggestions.
- **Owner:** manage editors and trees, permanently delete people. No public signup or tree creation.

## Develop

Requires Node.js 26, pnpm, and [uv](https://docs.astral.sh/uv/).

```sh
pnpm --dir web install --frozen-lockfile
pnpm --dir web build
pnpm --dir web dev
```

Open **http://localhost:8000/family-tree/**; forward **8000 → 8000** in a sandbox. The local-only password is `local-preview-only`. Preview data stays in ignored `web/.local/`; production data lives in Cloudflare D1/R2.

## MCP

Run `uv run family-tree-mcp` with `FAMILY_TREE_URL` set to your website's `/family-tree` URL and `FAMILY_TREE_TOKEN` set through your client's secret/environment settings. The token grants owner access; never commit it. Successful changes appear immediately—no export or publish step.

Search all people before creating someone: UUIDs and photos are shared across trees. Stale edits fail instead of overwriting another relative's work.

## Verify

```sh
pnpm --dir web check && pnpm --dir web build && pnpm --dir web test
uv sync --locked
uv run ruff format --check . && uv run ruff check . && uv run ty check && uv run pytest
```

Code: `web/src` (app/API), `web/ui` (graph), `mcp/src` (local tools). [Deployment and recovery →](docs/operations.md)

[MIT](LICENSE) · [ELK.js license](web/ui/vendor/README.md)
