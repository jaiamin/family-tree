# family-tree-mcp

An [MCP](https://modelcontextprotocol.io) server for building family trees, naming how people are related, and sharing the tree as a live link.

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

Trees are JSON files in `~/.family-tree-mcp/` (or `FAMILY_TREE_DIR`). Every change is backed up, so `undo` can revert it.

## Tools

| Tool | Purpose |
| --- | --- |
| `list_trees`, `create_tree`, `rename_tree`, `delete_tree`, `get_tree`, `undo` | Manage trees; `list_trees` also shows when each site last updated |
| `add_people` | Add a family and its links in one call |
| `add_person`, `update_person`, `remove_person`, `merge_people` | Edit people |
| `update_people` | Many renames, details and links at once, undone as one step |
| `check_tree` | Review children linked to only one of a couple, same-name people and placeholders |
| `add_relationship`, `remove_relationship` | Link people as parent, child, partner or sibling |
| `find_people`, `get_person`, `get_ancestors`, `get_descendants` | Look people up |
| `get_relationship` | e.g. "Sam is Ava's first cousin once removed" |
| `get_diagram` | Mermaid chart to view in the chat |
| `export_gedcom` | GEDCOM file for Ancestry, FamilySearch, Gramps, etc. |
| `publish_site`, `export_html` | Web page of the tree, online (with family photos) or as a file |
| `change_photo_code` | Replace the code family use to add photos |

## Sharing

Ask your agent to *"publish the family tree"*. You get a free [Cloudflare Pages](https://pages.cloudflare.com) link that updates itself 30 seconds after you stop editing. Viewers can browse the tree, search for anyone, and tap a person to see their details and family, but can't edit. Details of people who may be living are hidden by default.

**Photos.** Publishing also gives you a family code such as `amber-river-falcon-42`. Share it with family: on the site they tap a person's picture, choose **Add photo**, and enter the code once on that device. Photos are cropped to a square and stored in [Workers KV](https://developers.cloudflare.com/kv/) on your Cloudflare account (free tier). Only a hash of the code is uploaded. To lock out an old code, ask your agent to *"change the photo code"*. Photos aren't included in `export_html` files or GEDCOM exports.

One-time setup: a free Cloudflare account, [Node.js](https://nodejs.org), and `npx wrangler login`. Anyone with the link can view it; use [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) to restrict it. To use your own domain (e.g. `family.example.com`), add it under the project's **Custom domains** in the Cloudflare dashboard. To take it down, run `npx wrangler pages project delete <project>`, and delete the `<project>-photos` KV namespace in the dashboard.

The viewer uses one top-to-bottom graph with compact couples, search, pan and zoom. Desktop details open beside the canvas; mobile details expand below it. The bundled [ELK.js layout engine](src/family_tree_mcp/vendor/README.md) runs locally in the page.

## Development

Install Node.js as well as uv to run the JavaScript layout regression tests.

```sh
uv sync
uv run ruff format . && uv run ruff check . && uv run ty check && uv run pytest
```

## License

Project code: MIT. The bundled ELK.js engine is distributed under [EPL-2.0](src/family_tree_mcp/vendor/ELK-LICENSE.md).
