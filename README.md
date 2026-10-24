# family-tree-mcp

An [MCP](https://modelcontextprotocol.io) server for building family trees, naming how people are related, and sharing multiple trees through one website.

## Install

Requires [uv](https://docs.astral.sh/uv/). Add to your MCP client:

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

Or in Claude Code: `claude mcp add family-tree -- uvx --from git+https://github.com/jaiamin/family-tree-mcp family-tree-mcp`

Or in Codex: `codex mcp add family-tree -- uvx --from git+https://github.com/jaiamin/family-tree-mcp family-tree-mcp`

To update, run `uvx --refresh --from git+https://github.com/jaiamin/family-tree-mcp family-tree-mcp` and restart your client.

## How it works

Each person has a name and optional sex, birth/death dates, birthplace and notes. Only two links are stored: **parents** (at most two) and **partners** (optionally married or divorced, with dates and place). Siblings, cousins, in-laws and step-relations are derived, so the tree can't contradict itself.

One `collection.json` in `~/.family-tree-mcp/` (or `FAMILY_TREE_DIR`) stores shared people, relationships, tree memberships and website configuration. People and trees have permanent UUIDs, independent of names. A person can belong to several trees without being copied; their details, relationships and photo are shared. A tree shows only its members and the links between them.

`find_people` without `tree` searches everyone. Use `set_tree_members` to reuse existing people in another tree, or remove just their membership. `remove_person` deletes a person everywhere; `merge_people` updates every membership. Deleting a tree preserves its people. Every transaction is backed up (last 50); **`undo` restores the most recent collection-wide change**, including all affected trees and settings.

### Updating from per-tree storage

This release uses the collection model exclusively. Point `FAMILY_TREE_DIR` at a **new empty folder**, restart your MCP client, configure the website, and recreate your trees using the MCP tools. Old per-tree files are never read as a substitute or modified; retain them as your source/backup. Existing name-based person links and photo keys do not carry over to new UUIDs. Re-upload photos after rebuilding. Do not publish until you have checked the new collection locally.

## Tools

| Tool | Purpose |
| --- | --- |
| `list_trees`, `create_tree`, `rename_tree`, `delete_tree`, `get_tree`, `undo` | Manage trees; undo is collection-wide |
| `set_tree_members` | Add existing UUIDs to a tree or remove membership only |
| `add_people` | Add a family and its links in one call |
| `add_person`, `update_person`, `remove_person`, `merge_people` | Edit people |
| `update_people` | Many renames, details and links at once, undone as one step |
| `check_tree` | Review children linked to only one of a couple, same-name people and placeholders |
| `add_relationship`, `remove_relationship` | Link people as parent, child, partner or sibling |
| `find_people`, `get_person`, `get_ancestors`, `get_descendants` | Look people up |
| `get_relationship` | e.g. "Sam is Ava's first cousin once removed" |
| `get_diagram` | Mermaid chart to view in the chat |
| `export_gedcom` | GEDCOM file for Ancestry, FamilySearch, Gramps, etc. |
| `configure_website`, `get_website` | Set site title/project and inspect publication status |
| `publish_site`, `export_website` | Publish or locally build the complete website and chooser |
| `change_photo_code` | Replace the code family use to add photos |

## Sharing

First call `configure_website(name="Your website", project="your-project")`. The title and Cloudflare project are independent of tree names; the project is fixed for this collection. Create any number of trees, then use `export_website` to preview. The homepage **always asks visitors to select a tree**, including when only one exists. Each tree has a stable `/trees/<tree-uuid>/` URL and a tree selector. The site title returns home; clicking the current tree name resets its view. The dropdown arrow switches between trees. A person’s details list **Other trees** when they are shared; each link opens the other tree focused on that same person. Renaming a tree preserves its URL and person links.

When ready, call `publish_site()` with no tree argument. It publishes **every tree in the collection** to one free [Cloudflare Pages](https://pages.cloudflare.com) link. With `keep_updated=True` (default), edits trigger a full-site rebuild 30 seconds after editing pauses, so updating one tree cannot overwrite the others. The MCP server must be running for automatic updates; restarting it does not publish changes made outside the tools. Call `publish_site` to publish immediately; use `get_website` to see pending updates or errors. `keep_updated=False` disables automatic deployments. Viewers can browse the tree, search for anyone, and tap a person to see their details and family, but can't edit. Details of people who may be living are hidden by default.

**Photos.** Publishing also gives you a family code such as `amber-river-falcon-42`. Share it with family: on the site they tap a person's picture, choose **Add photo**, and enter the code once on that device. Photos are cropped to a square and stored in [Workers KV](https://developers.cloudflare.com/kv/) on your Cloudflare account (free tier). Only a hash of the code is uploaded. To lock out an old code, ask your agent to *"change the photo code"*. Photos are stored by person UUID, so the same person uses the same photo in every tree. GEDCOM exports do not include photos. A static local preview has no Cloudflare photo endpoint; photo uploads work on the published site.

One-time setup: a free Cloudflare account, [Node.js](https://nodejs.org), and `npx wrangler login`. Anyone with the link can view it; use [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) to restrict it. To use your own domain (e.g. `family.example.com`), add it under the project's **Custom domains** in the Cloudflare dashboard. To take it down, run `npx wrangler pages project delete <project>`, and delete the `<project>-photos` KV namespace in the dashboard.

The viewer uses one top-to-bottom graph with compact couples, search, pan and zoom. Desktop details open beside the canvas; mobile details expand below it. The bundled [ELK.js layout engine](src/family_tree_mcp/vendor/README.md) runs locally in the page.

## Reusing the project

Use your own empty data folder, configure your own website title and Cloudflare project, and create your own trees. No family records, website name, domain or family name are built into the source. Separate installations use separate collections and Cloudflare projects; UUID sharing applies within one collection.

## Agent workflow

1. Start with `list_trees`, `get_website` and `find_people` without a tree filter. Search globally before creating a person; use returned UUIDs rather than inventing IDs.
2. Use `configure_website` once for the site name/project. Create trees with `create_tree`; use `add_people` with batch `ref` values to add people and explicit parent/partner links. The gender field is `sex`, accepting `male` or `female` (omit when unknown).
3. Use `update_people` for batch corrections and partnership status. For a link, `relative_id` is `person_id`'s `relation`. A partner is never automatically a parent. Don't add guessed parents or dates to silence review notes.
4. Use `set_tree_members` to share an existing person across trees. Membership removal affects only that tree; `remove_person` and `merge_people` affect every tree. `undo` reverses the last collection-wide transaction.
5. Verify records with `get_tree` and `check_tree`, then `export_website` for local review. Only call `publish_site` after publication is requested; it publishes all trees, and subsequent tool edits update it automatically while the server runs. Use `get_website` to inspect update status.

For a fresh start, preserve the previous data folder, configure a new empty **absolute** `FAMILY_TREE_DIR` in your MCP client, and restart the server. Don't delete the original records or remote photo storage until the rebuilt collection has been checked. New UUIDs mean old person links and photos need to be recreated.

## Local preview

Call `export_website(hide_living=True)` and serve the returned folder:

```sh
uv run python -m http.server 8000 --bind 0.0.0.0 --directory /path/returned/by/export_website
```

Open `http://localhost:8000/` (publish/map port **8000 → 8000** in a sandbox). Check the chooser, open each tree, search/select a person, switch trees with the dropdown, and return home by clicking the site name. Re-export and refresh after edits; exporting never deploys. Set `hide_living=False` only when you intend to include living details in that local output.

## Development

Install Node.js as well as uv to run the JavaScript layout regression tests.

```sh
uv sync
uv run ruff format . && uv run ruff check . && uv run ty check && uv run pytest
```

## License

Project code: MIT. The bundled ELK.js engine is distributed under [EPL-2.0](src/family_tree_mcp/vendor/ELK-LICENSE.md).
