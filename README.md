# family-tree-mcp

Build family trees through your AI agent and share a website with search, photos, two layouts, and person links. Records stay local; visitors can view trees and update photos with a family code.

## Setup

Install [uv](https://docs.astral.sh/uv/) and add to your MCP client:

```json
{
  "mcpServers": {
    "family-tree": {
      "command": "uvx",
      "args": ["--from", "git+https://github.com/jaiamin/family-tree-mcp", "family-tree-mcp"]
    }
  }
}
```

Tell your agent which people and relationships to add; tool instructions are built in. People have stable UUIDs shared across trees; search before creating duplicates.

**Update:** quit your client, run this, press Ctrl+C after startup, then reopen the client:

```sh
uvx --refresh --from git+https://github.com/jaiamin/family-tree-mcp family-tree-mcp
```

## Website

Ask your agent to:

1. Configure with `configure_website(name="Your website", project="your-project")`. The project is fixed afterward.
2. Preview with `export_website`, then serve its returned folder:

   ```sh
   uv run python -m http.server 8000 --bind 0.0.0.0 --directory /returned/folder
   ```

   Open **http://localhost:8000/**; map **8000 → 8000** in a sandbox. Re-export after edits.
3. Publish with `publish_site`. Requires [Node.js](https://nodejs.org), a [Cloudflare](https://pages.cloudflare.com) account, and `npx wrangler login` in your terminal.

**Every tree is published.** Names, relationships, and photos are public; living dates, places, and notes are hidden by default. Use [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) for private viewing.

MCP edits auto-publish after 30 seconds while the server runs. **Code updates require `publish_site` again**; merging or exporting does not deploy. `get_website` reports status/errors.

Publishing returns the photo code; `change_photo_code` replaces it. Photos live separately in Cloudflare KV; uploads require the published site.

**Ask about the family (optional):** visitors can ask questions like "How is Jai related to Varshaben?" and Claude Haiku answers from the published tree, never seeing hidden details. It uses your own [Anthropic API key](https://console.anthropic.com/settings/keys); set a monthly spend limit in the console. Each question costs about a tenth of a cent, and the site answers at most 200 questions a day. Store the key yourself, then run `publish_site` again:

```sh
npx wrangler pages secret put ANTHROPIC_API_KEY --project-name your-project
```

The Ask button appears only on the published site once the key is set, not in local previews. To turn it off, run `npx wrangler pages secret delete ANTHROPIC_API_KEY --project-name your-project`, then `publish_site`.

## Data and recovery

Back up `~/.family-tree-mcp/`. Its `collection.json` holds records and settings; configure an absolute `FAMILY_TREE_DIR` and restart to use another folder.

Shared-person edits, `remove_person`, and `merge_people` affect every tree. Removing membership or deleting a tree preserves people. `undo` restores the latest collection-wide change; 50 transaction backups are retained.

Old per-tree JSON is unsupported. Preserve originals; rebuilding with new UUIDs requires new person links and photo uploads.

## Development

Requires uv and Node.js.

```sh
uv sync
uv run ruff format --check . && uv run ruff check . && uv run ty check && uv run pytest
```

[MIT](LICENSE); bundled [ELK.js](src/family_tree_mcp/vendor/README.md): [EPL-2.0](src/family_tree_mcp/vendor/ELK-LICENSE.md).
