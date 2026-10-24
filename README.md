# family-tree-mcp

An [MCP](https://modelcontextprotocol.io) server that lets any agent build family trees and reason about how people are related. Built with [FastMCP](https://gofastmcp.com).

## Install

Requires [uv](https://docs.astral.sh/uv/). Add the server to your MCP client:

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

For Claude Code:

```sh
claude mcp add family-tree -- uvx --from git+https://github.com/jaiamin/family-tree-mcp family-tree-mcp
```

Trees are saved as JSON files in `~/.family-tree-mcp/`. Set `FAMILY_TREE_DIR` to store them elsewhere. Every change keeps a backup of the previous version (the last 50 per tree), so `undo` can revert mistakes or restore a deleted tree.

## Model

A tree contains people. Each person has an id, a name, optional details (`sex`, `birth_date`, `death_date`, `birth_place`, `notes`), and two kinds of links:

- **parents**: at most two per person, with cycles rejected.
- **partners**: always recorded on both people.

Everything else (children, siblings, aunts, cousins, in-laws) is derived from those links, so the data stays consistent and the agent never has to keep inverse relations in sync. Linking two people as `sibling` gives them the same parents, adding a placeholder parent when neither has one. Children and siblings are listed oldest first when birth dates are known.

## Tools

| Tool | Purpose |
| --- | --- |
| `list_trees`, `create_tree`, `delete_tree`, `get_tree` | Manage trees |
| `undo` | Revert the last change, or restore a deleted tree |
| `add_person`, `update_person`, `remove_person` | Manage people |
| `add_relationship`, `remove_relationship` | Link people as `parent`, `child`, `partner` or `sibling` |
| `find_people` | Search by name to get ids |
| `get_person` | Details with parents, partners, children and siblings |
| `get_relationship` | Name the relation, e.g. "Sam is Ava's first cousin once removed." |
| `get_ancestors`, `get_descendants` | Lineage grouped by generation |
| `get_diagram` | Mermaid chart of the whole tree or one person's ancestors/descendants |
| `export_diagram` | Save that chart as a `.mmd` file plus a [mermaid.live](https://mermaid.live) link for PNG/SVG/PDF download |
| `export_gedcom` | Save the tree as a GEDCOM file for other genealogy apps |
| `export_html` | Save a read-only, interactive web page of the tree to share as a link |

`get_diagram` returns [Mermaid](https://mermaid.js.org) source, which Claude, ChatGPT, GitHub and most Markdown viewers render as a chart. Couples join at a dot above their children, boxes are colored by sex (blue, pink, gray when unknown), deceased people are dashed and faded, and the focus person has an orange border.

`export_gedcom` writes a GEDCOM 5.5.1 file to `~/.family-tree-mcp/exports/`, which Ancestry, FamilySearch, MyHeritage, Gramps and most other genealogy apps can import. The last word of a name becomes the surname, and dates that aren't ISO are kept as text.

Ask your agent something like *"Start a tree for my family: my parents are Maria and José, and my grandmother on my mom's side is Rosa"*, then *"How is Rosa related to my cousin Luis?"*

## Sharing a tree

`export_html` writes a single `index.html` to `~/.family-tree-mcp/exports/<tree>-site/`. Viewers can browse the chart, tap anyone for their details, and pick two people to see how they're related. Nothing can be edited. By default, birth dates, birthplaces and notes are hidden for anyone who may be living: no death date, and not born over 100 years ago. The page also asks search engines not to index it.

To get a free, permanent link, publish the folder to [Cloudflare Pages](https://pages.cloudflare.com). This needs a free Cloudflare account, and you run the same command again after each re-export:

```sh
npx wrangler pages deploy ~/.family-tree-mcp/exports/<tree>-site --project-name <tree>
```

The page is then at `https://<tree>.pages.dev`. Anyone with the link can view it. To limit it to specific people, turn on [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) for the project (free for up to 50 users).

## Updating

uvx caches the server, so refresh it after an update, then restart your MCP client:

```sh
uvx --refresh --from git+https://github.com/jaiamin/family-tree-mcp family-tree-mcp
```

Your trees are not affected.

## Development

```sh
uv sync
uv run pytest
uv run ruff format . && uv run ruff check . && uv run ty check
```

## License

MIT
