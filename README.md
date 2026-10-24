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

To update, run `uvx --refresh --from git+https://github.com/jaiamin/family-tree-mcp family-tree-mcp` and restart your client.

## How it works

Each person has a name and optional sex, birth/death dates, birthplace and notes. Only two links are stored: **parents** (at most two) and **partners** (optionally married or divorced, with dates and place). Siblings, cousins, in-laws and step-relations are derived, so the tree can't contradict itself.

Trees are JSON files in `~/.family-tree-mcp/` (or `FAMILY_TREE_DIR`). Every change is backed up, so `undo` can revert it.

## Tools

| Tool | Purpose |
| --- | --- |
| `list_trees`, `create_tree`, `rename_tree`, `delete_tree`, `get_tree`, `undo` | Manage trees |
| `add_people` | Add a family and its links in one call |
| `add_person`, `update_person`, `remove_person`, `merge_people` | Edit people |
| `add_relationship`, `remove_relationship` | Link people as parent, child, partner or sibling |
| `find_people`, `get_person`, `get_ancestors`, `get_descendants` | Look people up |
| `get_relationship` | e.g. "Sam is Ava's first cousin once removed" |
| `get_diagram` | Mermaid chart to view in the chat |
| `export_gedcom` | GEDCOM file for Ancestry, FamilySearch, Gramps, etc. |
| `publish_site`, `export_html` | Read-only web page of the tree, online or as a file |

## Sharing

Ask your agent to *"publish the family tree"*. You get a free [Cloudflare Pages](https://pages.cloudflare.com) link that updates itself 30 seconds after you stop editing. Viewers can browse the tree, search for anyone, and tap a person to see their details and family, but can't edit. Details of people who may be living are hidden by default.

One-time setup: a free Cloudflare account, [Node.js](https://nodejs.org), and `npx wrangler login`. Anyone with the link can view it; use [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) to restrict it. To use your own domain (e.g. `family.example.com`), add it under the project's **Custom domains** in the Cloudflare dashboard. To take it down, run `npx wrangler pages project delete <project>`.

## Development

```sh
uv sync
uv run ruff format . && uv run ruff check . && uv run ty check && uv run pytest
```

## License

MIT
