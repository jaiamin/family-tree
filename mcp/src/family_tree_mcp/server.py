"""MCP tools for building and reasoning over family trees."""

import os
from typing import Annotated

from fastmcp import FastMCP
from mcp.types import ToolAnnotations
from pydantic import Field

from family_tree_mcp.store import Store
from family_tree_mcp.tree import (
    LinkChange,
    NewPerson,
    PersonChange,
    Tree,
)

INSTRUCTIONS = """\
Manage the private family website through its authenticated API. The website is the source
of truth: successful edits appear immediately; there are no local records to publish.
People and trees have immutable UUIDs. Search find_people WITHOUT tree before adding anyone;
use set_tree_members to reuse an existing person. Shared-person edits apply across trees.
A partner is not automatically a parent. Ask before filling missing parent connections.
Use add_people for atomic batches of new people; update_people for metadata and links.
Each link reads "relative_id is person_id's relation"; remove=true disconnects that link.
Run check_tree after large edits. Merge duplicates with merge_people only when confirmed.
Removing tree membership preserves the record; remove_person affects every tree.
Website visitors cannot create trees; the owner's MCP can manage tree definitions.
If a save conflicts with another edit, re-read the current records and reconsider the change;
never silently overwrite someone else's work or retry stale data.
Suggestions are private, named family feedback. Review them before changing records.
For migration, import_collection loads a local collection.json into an EMPTY hosted website
without changing UUIDs. It never replaces a populated website.
Dates are free text; prefer YYYY, YYYY-MM, or YYYY-MM-DD. The service maintains one rolling
backup and preserves original photo uploads, but there is no per-edit undo tool.
"""

READ = ToolAnnotations(read_only_hint=True, open_world_hint=True)
WRITE = ToolAnnotations(destructive_hint=False, open_world_hint=True)
DELETE = ToolAnnotations(destructive_hint=True, open_world_hint=True)

TreeName = Annotated[
    str, Field(description="Stable tree UUID (preferred) or exact name, as shown by list_trees.")
]
PersonId = Annotated[
    str, Field(description="Person UUID, as returned by add_people or find_people.")
]


def create_server(store: Store) -> FastMCP:
    mcp = FastMCP("family-tree", instructions=INSTRUCTIONS)

    @mcp.tool(annotations=READ)
    def list_trees() -> list[dict]:
        """List all trees with stable UUIDs, descriptions and membership counts."""
        return [
            {"id": t.id, "name": t.name, "description": t.description, "people": len(t.people)}
            for t in store.trees()
        ]

    @mcp.tool(annotations=READ)
    def get_website() -> dict:
        """Read the website URL, signed-in owner, and backup status."""
        return {"url": store.url, **store.request("/session")}

    @mcp.tool(annotations=WRITE)
    def import_collection(path: str) -> dict:
        """Import a local collection.json into an empty website, preserving person/tree UUIDs.

        Use only for the initial migration. A populated website is never overwritten.
        """
        return store.import_collection(path)

    @mcp.tool(annotations=READ)
    def list_suggestions() -> list[dict]:
        """Read private family suggestions, including the sender and related person."""
        return store.request("/suggestions")

    @mcp.tool(annotations=WRITE)
    def review_suggestion(suggestion_id: str, reviewed: bool = True) -> dict:
        """Mark a suggestion reviewed (or reopen it) without changing family records."""
        return store.request(
            f"/suggestions/{suggestion_id}", {"status": "done" if reviewed else "open"}, "PATCH"
        )

    @mcp.tool(annotations=WRITE)
    def set_tree_members(tree: TreeName, person_ids: list[str], remove: bool = False) -> dict:
        """Add existing collection people to a tree, or remove membership only.

        Reuse UUIDs found with find_people (omit tree to search all people). Relationships
        are visible whenever both endpoints belong to the tree; no person is copied.
        Removing membership preserves the person's record and all global relationships.
        """
        t = store.membership(tree, person_ids, remove)
        return {"id": t.id, "name": t.name, "people": len(t.people)}

    @mcp.tool(annotations=WRITE)
    def create_tree(name: str, description: str = "") -> dict:
        """Create a new, empty family tree."""
        tree = store.create(name, description)
        return {"id": tree.id, "name": tree.name, "description": tree.description}

    @mcp.tool(annotations=WRITE)
    def rename_tree(tree: TreeName, new_name: str) -> dict:
        """Rename a tree. People and relationships are kept."""
        renamed = store.rename(tree, new_name)
        return {"id": renamed.id, "name": renamed.name, "people": len(renamed.people)}

    @mcp.tool(annotations=DELETE)
    def delete_tree(tree: TreeName) -> str:
        """Delete only a tree definition. Shared people and photo uploads remain."""
        store.delete(tree)
        return f"Deleted tree '{tree}'. Shared people were retained."

    @mcp.tool(annotations=READ)
    def get_tree(tree: TreeName) -> dict:
        """Return the whole tree: every person with their parent and partner ids."""
        return store.load(tree).model_dump(exclude_none=True)

    @mcp.tool(annotations=WRITE)
    def add_people(tree: TreeName, people: list[NewPerson]) -> dict:
        """Add one or many people and their parent, partner and sibling links in one call.

        Use a one-entry list to add a single person. Each entry can
        link to others in the batch by their ref (or name) and to existing people by id.
        All entries are added, or none are if any link is invalid.
        """
        with store.edit(tree) as t:
            existing = {p.name.casefold(): p.id for p in store.collection().people.values()}
            ids = t.add_people(people)
            notes = checks(t, set(ids.values()))
        duplicates = [
            {"new_id": ids[p.ref or p.name], "existing_id": existing[p.name.casefold()]}
            for p in people
            if p.name.casefold() in existing
        ]
        return {"ids": ids, "possible_duplicates": duplicates, **notes}

    @mcp.tool(annotations=WRITE)
    def update_people(
        tree: TreeName,
        changes: list[PersonChange] | None = None,
        links: list[LinkChange] | None = None,
    ) -> dict:
        """Change many existing people at once: details and renames, then links to add or remove.

        Use for one or many person updates or relationship changes.
        Each link reads "relative_id is person_id's relation"; set
        remove=true to remove it. Everything applies, or nothing does if any entry fails, and
        the server rejects stale edits. To add new people, use add_people.
        """
        changes, links = changes or [], links or []
        with store.edit(tree) as t:
            t.apply(changes, links)
            touched = {c.id for c in changes}
            touched |= {i for link in links for i in (link.person_id, link.relative_id)}
            notes = checks(t, touched)
        removed = sum(link.remove for link in links)
        return {
            "updated": len(changes),
            "links_added": len(links) - removed,
            "links_removed": removed,
            **notes,
        }

    @mcp.tool(annotations=DELETE)
    def merge_people(tree: TreeName, keep_id: PersonId, duplicate_id: PersonId) -> dict:
        """Merge a duplicate into keep_id, then remove the duplicate.

        Applies across EVERY tree. Fills keep_id's missing details from the duplicate
        and moves its parents, partners and children. Also use it to replace a placeholder
        parent with the real person.
        """
        current = store.load(tree)
        current.get(keep_id)
        current.get(duplicate_id)
        store.merge(keep_id, duplicate_id)
        return store.load(tree).profile(keep_id)

    @mcp.tool(annotations=DELETE)
    def remove_person(tree: TreeName, person_id: PersonId) -> str:
        """Delete a person and all relationships from EVERY tree.

        To remove only their appearance in one tree, use set_tree_members(remove=True).
        """
        name = store.load(tree).get(person_id).name
        store.remove_person(person_id)
        return f"Deleted {name} from the collection and all trees."

    @mcp.tool(annotations=READ)
    def find_people(query: str = "", tree: TreeName | None = None) -> list[dict]:
        """Find names matching every query word. Omit tree to search the shared collection.

        Search globally before creating people; reuse existing UUIDs with set_tree_members."""
        return [
            p.model_dump(include={"id", "name", "birth_date", "death_date"}, exclude_none=True)
            for p in (store.load(tree) if tree else store.collection().graph()).find(query)
        ]

    @mcp.tool(annotations=READ)
    def get_person(tree: TreeName, person_id: PersonId) -> dict:
        """Get a person's details with their parents, partners, children and siblings."""
        return store.load(tree).profile(person_id)

    @mcp.tool(annotations=READ)
    def check_tree(tree: TreeName) -> dict:
        """List things to review: children linked to only one of a couple, people with the same
        name, and placeholder parents. Report them to the user rather than fixing them unasked.
        """
        issues = store.load(tree).check()
        return {"issues": issues, "summary": f"{len(issues)} to review" if issues else "All clear."}

    @mcp.tool(annotations=READ)
    def get_relationship(tree: TreeName, person_id: PersonId, relative_id: PersonId) -> dict:
        """Name how relative_id is related to person_id (e.g. "first cousin once removed")."""
        return store.load(tree).relationship(person_id, relative_id)

    @mcp.tool(annotations=READ)
    def get_ancestors(
        tree: TreeName, person_id: PersonId, generations: int | None = None
    ) -> list[dict]:
        """List a person's ancestors by generation (1 = parents, 2 = grandparents, ...)."""
        return store.load(tree).lineage(person_id, "ancestors", generations)

    @mcp.tool(annotations=READ)
    def get_descendants(
        tree: TreeName, person_id: PersonId, generations: int | None = None
    ) -> list[dict]:
        """List a person's descendants by generation (1 = children, 2 = grandchildren, ...)."""
        return store.load(tree).lineage(person_id, "descendants", generations)

    def checks(t: Tree, people: set[str]) -> dict:
        """One-parent children involving these people, as notes for an edit's result."""
        notes = [issue["summary"] for issue in t.check(people)]
        return {"check": notes} if notes else {}

    return mcp


def main() -> None:
    url = os.environ.get("FAMILY_TREE_URL", "")
    token = os.environ.get("FAMILY_TREE_TOKEN", "")
    if not url or not token:
        raise SystemExit("Set FAMILY_TREE_URL and FAMILY_TREE_TOKEN for your hosted website.")
    create_server(Store(url, token)).run(show_banner=False)
