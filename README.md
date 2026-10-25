# family-tree-mcp

Build and update family trees through an AI agent, then share a family website with search, photos, top-down/left-to-right layouts, and links to individual people. Family records stay local; the website is for viewing and password-protected photo updates.

## Install

Install [uv](https://docs.astral.sh/uv/), then add this to your MCP client:

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

**Update:** quit your client, run the command below, press Ctrl+C once the server starts, then reopen your client. Republish to update the website’s code.

```sh
uvx --refresh --from git+https://github.com/jaiamin/family-tree-mcp family-tree-mcp
```

## Use

Tell your agent which people and relationships to add. The MCP supplies its own tool instructions; the core workflow is:

1. Search globally with `find_people` before creating anyone. Reuse existing UUIDs with `set_tree_members`.
2. `create_tree` creates a tree; `add_people` creates people and links. `update_people` edits details and relationships. Both accept single-entry batches.
3. Check with `check_tree`; explore with `get_person`, `get_relationship`, `get_ancestors`, and `get_descendants`.
4. Configure, preview, then publish as below. `get_website` reports publication status and errors.

People store names, gender (`sex`), dates, birthplace, and notes. Parent and partner links determine other relationships; a partner is **not automatically a parent**.

## Preview and publish

1. Ask the agent to call `configure_website(name="Your website", project="your-project")`. Choose your own title and Cloudflare project; the project cannot be changed afterward in this collection.
2. Call `export_website`, then serve its returned folder:

   ```sh
   uv run python -m http.server 8000 --bind 0.0.0.0 --directory /returned/folder
   ```

   Open **http://localhost:8000/**; map **8000 → 8000** in a sandbox. Re-export after edits. Exporting never deploys.
3. For publishing, install [Node.js](https://nodejs.org), create a [Cloudflare](https://pages.cloudflare.com) account, and run `npx wrangler login` in your terminal. Ask the agent to call `publish_site`.

**Publishing includes every tree.** Anyone with the link can view names, relationships, and photos. Living dates, places, and notes are hidden by default (`hide_living=True`); this is not private access. Use [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) to restrict viewing.

MCP edits automatically republish after 30 seconds of inactivity while the server runs (`keep_updated=True`). Call `publish_site` to publish immediately or after a code update. Git merges and local exports do not update the live site.

Publishing returns a photo code: relatives tap a person’s picture to add/change/remove photos. Photos live in Cloudflare KV and are shared across trees by UUID. `change_photo_code` replaces the code. Photo editing requires the published API; static previews cannot upload photos.

## Data

`~/.family-tree-mcp/collection.json` stores people, relationships, trees, and website settings. Set an absolute `FAMILY_TREE_DIR` in your MCP client to use another folder; restart afterward. Back up this folder. Photos are stored separately in Cloudflare.

- UUIDs survive renames. Shared-person edits affect every tree.
- Removing tree membership or deleting a tree preserves people; `remove_person` and `merge_people` affect the whole collection.
- The last 50 transaction backups support `undo`, which reverts the latest **collection-wide** change.
- Old per-tree JSON is unsupported. Preserve it and rebuild in a new empty folder; new UUIDs require new person links and photo uploads.

## Development

Requires uv and Node.js (for layout tests).

```sh
uv sync
uv run ruff format --check . && uv run ruff check . && uv run ty check && uv run pytest
```

[MIT](LICENSE); bundled [ELK.js](src/family_tree_mcp/vendor/README.md) is [EPL-2.0](src/family_tree_mcp/vendor/ELK-LICENSE.md).
