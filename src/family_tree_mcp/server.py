"""MCP tools for building and reasoning over family trees."""

import os
from pathlib import Path
from typing import Annotated

from fastmcp import FastMCP
from mcp.types import ToolAnnotations
from pydantic import Field

from family_tree_mcp.diagram import View, mermaid
from family_tree_mcp.gedcom import to_gedcom
from family_tree_mcp.store import Store
from family_tree_mcp.tree import Relation, Sex, slugify

INSTRUCTIONS = """\
Manage family trees. Each tree holds people linked by two kinds of edges:
parent (at most two per person) and partner. Children, siblings, cousins, in-laws
and every other relation are derived, so never record them directly.

Workflow: call find_people before add_person to avoid duplicates, then connect
people with add_relationship. Use get_relationship to name how two people are
related, and get_person, get_ancestors or get_descendants to explore.
To show the tree visually, use get_diagram and display its output in a ```mermaid block.
To move a tree to Ancestry, FamilySearch, MyHeritage, Gramps etc., use export_gedcom.
Dates are free text; prefer ISO format (YYYY, YYYY-MM or YYYY-MM-DD).
"""

READ = ToolAnnotations(read_only_hint=True, open_world_hint=False)
WRITE = ToolAnnotations(destructive_hint=False, open_world_hint=False)
DELETE = ToolAnnotations(destructive_hint=True, open_world_hint=False)

TreeName = Annotated[str, Field(description="Tree name, as shown by list_trees.")]
PersonId = Annotated[str, Field(description="Person id, as returned by add_person or find_people.")]
Text = Annotated[str | None, Field(description="Omit to leave unchanged; empty string clears.")]


def create_server(store: Store) -> FastMCP:
    mcp = FastMCP("family-tree", instructions=INSTRUCTIONS)

    @mcp.tool(annotations=READ)
    def list_trees() -> list[dict]:
        """List all family trees with their size."""
        return [
            {"name": t.name, "description": t.description, "people": len(t.people)}
            for t in store.list()
        ]

    @mcp.tool(annotations=WRITE)
    def create_tree(name: str, description: str = "") -> dict:
        """Create a new, empty family tree."""
        tree = store.create(name, description)
        return {"name": tree.name, "description": tree.description}

    @mcp.tool(annotations=DELETE)
    def delete_tree(tree: TreeName) -> str:
        """Permanently delete a family tree and everyone in it."""
        store.delete(tree)
        return f"Deleted tree '{tree}'."

    @mcp.tool(annotations=READ)
    def get_tree(tree: TreeName) -> dict:
        """Return the whole tree: every person with their parent and partner ids."""
        return store.load(tree).model_dump(exclude_none=True)

    @mcp.tool(annotations=WRITE)
    def add_person(
        tree: TreeName,
        name: str,
        sex: Sex | None = None,
        birth_date: str | None = None,
        death_date: str | None = None,
        birth_place: str | None = None,
        notes: str | None = None,
    ) -> dict:
        """Add a person to the tree and return them, including their new id."""
        with store.edit(tree) as t:
            person = t.add_person(
                name,
                sex=sex,
                birth_date=birth_date,
                death_date=death_date,
                birth_place=birth_place,
                notes=notes,
            )
        return person.model_dump(exclude_none=True)

    @mcp.tool(annotations=WRITE)
    def update_person(
        tree: TreeName,
        person_id: PersonId,
        name: str | None = None,
        sex: Sex | None = None,
        birth_date: Text = None,
        death_date: Text = None,
        birth_place: Text = None,
        notes: Text = None,
    ) -> dict:
        """Change a person's details. Only the fields you pass are updated."""
        with store.edit(tree) as t:
            t.update_person(
                person_id,
                name=name,
                sex=sex,
                birth_date=birth_date,
                death_date=death_date,
                birth_place=birth_place,
                notes=notes,
            )
            return t.profile(person_id)

    @mcp.tool(annotations=DELETE)
    def remove_person(tree: TreeName, person_id: PersonId) -> str:
        """Remove a person and all of their relationships."""
        with store.edit(tree) as t:
            name = t.get(person_id).name
            t.remove_person(person_id)
        return f"Removed {name}."

    @mcp.tool(annotations=WRITE)
    def add_relationship(
        tree: TreeName, person_id: PersonId, relation: Relation, relative_id: PersonId
    ) -> dict:
        """Record that relative_id is person_id's parent, child or partner.

        Example: relation="parent", person_id="ann", relative_id="bob" means Bob is Ann's parent.
        """
        with store.edit(tree) as t:
            t.link(person_id, relation, relative_id)
            return t.profile(person_id)

    @mcp.tool(annotations=DELETE)
    def remove_relationship(
        tree: TreeName, person_id: PersonId, relation: Relation, relative_id: PersonId
    ) -> dict:
        """Remove a parent, child or partner link recorded with add_relationship."""
        with store.edit(tree) as t:
            t.unlink(person_id, relation, relative_id)
            return t.profile(person_id)

    @mcp.tool(annotations=READ)
    def find_people(tree: TreeName, query: str = "") -> list[dict]:
        """Find people whose name contains every word in the query. Empty query lists everyone."""
        return [
            p.model_dump(include={"id", "name", "birth_date", "death_date"}, exclude_none=True)
            for p in store.load(tree).find(query)
        ]

    @mcp.tool(annotations=READ)
    def get_person(tree: TreeName, person_id: PersonId) -> dict:
        """Get a person's details with their parents, partners, children and siblings."""
        return store.load(tree).profile(person_id)

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

    @mcp.tool(annotations=READ)
    def get_diagram(
        tree: TreeName,
        person_id: Annotated[
            str | None, Field(description="Center the diagram on this person. Omit for everyone.")
        ] = None,
        view: View = "both",
        generations: int | None = None,
    ) -> str:
        """Draw the tree as a Mermaid flowchart. Show the result to the user in a ```mermaid block.

        Couples join at a dot above their children. Colors show sex (blue male, pink female,
        gray unknown), dashed faded boxes are deceased, and an orange border marks person_id.
        For large trees, pass person_id and generations to keep the diagram readable.
        """
        return mermaid(store.load(tree), person_id, view, generations)

    @mcp.tool(annotations=WRITE)
    def export_gedcom(tree: TreeName) -> dict:
        """Save the tree as a GEDCOM 5.5.1 (.ged) file for import into other genealogy apps.

        Returns the file path; give it to the user rather than reading the file into the chat.
        """
        t = store.load(tree)
        path = store.root / "exports" / f"{slugify(t.name)}.ged"
        path.parent.mkdir(exist_ok=True)
        path.write_text(to_gedcom(t), encoding="utf-8")
        return {"path": str(path), "people": len(t.people)}

    return mcp


def main() -> None:
    root = os.environ.get("FAMILY_TREE_DIR", Path.home() / ".family-tree-mcp")
    create_server(Store(Path(root))).run(show_banner=False)
