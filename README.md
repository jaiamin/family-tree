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

Trees are saved as JSON files in `~/.family-tree-mcp/`. Set `FAMILY_TREE_DIR` to store them elsewhere. Several apps or agents can use the same folder at once; changes are applied one at a time. Every change keeps a backup of the previous version (the last 50 per tree), so `undo` can revert mistakes or restore a deleted tree.

## Model

A tree contains people. Each person has an id, a name, optional details (`sex`, `birth_date`, `death_date`, `birth_place`, `notes`), and two kinds of links:

- **parents**: at most two per person, with cycles rejected.
- **partners**: always recorded on both people, optionally with a status (`married`, `divorced`, `partners`), marriage date and place, and divorce date.

Everything else (children, siblings, aunts, cousins, in-laws, step-relations) is derived from those links, so the data stays consistent and the agent never has to keep inverse relations in sync. Linking two people as `sibling` gives them the same parents, adding a placeholder parent when neither has one. Children and siblings are listed oldest first when birth dates are known.

## Tools

| Tool | Purpose |
| --- | --- |
| `list_trees`, `create_tree`, `rename_tree`, `delete_tree`, `get_tree` | Manage trees |
| `undo` | Revert the last change, or restore a deleted tree |
| `add_people` | Add a whole family and its links in one call |
| `add_person`, `update_person`, `remove_person` | Manage one person |
| `merge_people` | Combine a duplicate (or a placeholder parent) into one person |
| `add_relationship`, `remove_relationship` | Link people as `parent`, `child`, `partner` (with marriage details) or `sibling` |
| `find_people` | Search by name to get ids |
| `get_person` | Details with parents, partners (and marriage details), children and siblings (half-siblings marked) |
| `get_relationship` | Name the relation, e.g. "Sam is Ava's first cousin once removed", "mother-in-law", "former stepfather" |
| `get_ancestors`, `get_descendants` | Lineage grouped by generation |
| `get_diagram` | Mermaid chart of the whole tree or one person's ancestors/descendants |
| `export_diagram` | Save that chart as a `.mmd` file plus a [mermaid.live](https://mermaid.live) link for PNG/SVG/PDF download |
| `export_gedcom` | Save the tree as a GEDCOM file for other genealogy apps |
| `publish_site` | Put a read-only, interactive page of the tree online and keep it updated after every change |
| `export_html` | Save that page as a local file without publishing |

`get_diagram` returns [Mermaid](https://mermaid.js.org) source, which Claude, ChatGPT, GitHub and most Markdown viewers render as a chart. Couples join at a dot above their children (with dotted lines once divorced), boxes are colored by sex (blue, pink, gray when unknown), deceased people are dashed and faded, and the focus person has an orange border.

`export_gedcom` writes a GEDCOM 5.5.1 file to `~/.family-tree-mcp/exports/`, which Ancestry, FamilySearch, MyHeritage, Gramps and most other genealogy apps can import. The last word of a name becomes the surname, and dates that aren't ISO are kept as text.

Ask your agent something like *"Start a tree for my family: my parents are Maria and José, and my grandmother on my mom's side is Rosa"*, then *"How is Rosa related to my cousin Luis?"*

## Sharing a tree

Ask your agent to *"publish the family tree"*. `publish_site` puts a read-only page on a free [Cloudflare Pages](https://pages.cloudflare.com) link such as `https://amin-patel-family.pages.dev`, then republishes it in the background after every change, so the link always shows the latest tree. Viewers can browse the chart, tap anyone for their details, and pick two people to see how they're related. Nothing can be edited, and the page asks search engines not to index it.

By default, birth dates, birthplaces, notes and marriage dates are hidden for anyone who may be living: no death date, and not born over 100 years ago.

Setup, once: create a free Cloudflare account, install [Node.js](https://nodejs.org), and run `npx wrangler login` in a terminal. To stop automatic updates, ask the agent to publish with `keep_updated` off; to take the page down, run `npx wrangler pages project delete <project>`.

Anyone with the link can view the page. To limit it to specific people, turn on [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) for the project (free for up to 50 users).

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
