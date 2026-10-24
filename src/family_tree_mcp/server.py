"""MCP tools for building and reasoning over family trees."""

import atexit
import json
import os
from pathlib import Path
from typing import Annotated, Literal

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from mcp.types import ToolAnnotations
from pydantic import Field

from family_tree_mcp.diagram import View, mermaid
from family_tree_mcp.gedcom import to_gedcom
from family_tree_mcp.publish import Updater, deploy, new_code, photo_store, site_files
from family_tree_mcp.share import share_page
from family_tree_mcp.store import Store, write_atomic
from family_tree_mcp.tree import NewPerson, PartnerStatus, Relation, Sex, Site, Tree, slugify

INSTRUCTIONS = """\
Manage family trees. Each tree holds people linked by two kinds of edges:
parent (at most two per person) and partner (optionally married or divorced, with
dates). Children, siblings, cousins, in-laws, step-relations and every other
relation are derived from those edges.

Building: call find_people first to avoid duplicates. Enter families with add_people
(one call for many people and their links); use add_person and add_relationship for
single changes. Linking two people as "sibling" gives them shared parents, adding a
placeholder parent if neither has one. If someone was added twice, or a placeholder
turns out to be a known person, use merge_people.

Exploring: get_relationship names how two people are related; get_person,
get_ancestors and get_descendants list family. Children and siblings are listed
oldest first when birth dates are known.

Sharing: get_diagram returns Mermaid to display in a ```mermaid block; export_gedcom
writes a file for Ancestry, FamilySearch, MyHeritage, Gramps etc. To share with family,
call publish_site once: it puts a read-only page online and then updates it automatically
as the tree changes. Family can add photos on the page with the photo code publish_site
returns; change_photo_code replaces it.

Dates are free text; prefer ISO format (YYYY, YYYY-MM or YYYY-MM-DD).
Every change is backed up: if you make a mistake, or the user asks to revert, use undo.
"""

READ = ToolAnnotations(read_only_hint=True, open_world_hint=False)
WRITE = ToolAnnotations(destructive_hint=False, open_world_hint=False)
DELETE = ToolAnnotations(destructive_hint=True, open_world_hint=False)

TreeName = Annotated[str, Field(description="Tree name, as shown by list_trees.")]
PersonId = Annotated[str, Field(description="Person id, as returned by add_person or find_people.")]
DiagramFocus = Annotated[
    str | None, Field(description="Center the diagram on this person. Omit for everyone.")
]
Text = Annotated[str | None, Field(description="Omit to leave unchanged; empty string clears.")]
SexChange = Annotated[
    Sex | Literal[""] | None, Field(description="Omit to leave unchanged; empty string clears.")
]


def create_server(store: Store, publish_delay: float = 30) -> FastMCP:
    mcp = FastMCP("family-tree", instructions=INSTRUCTIONS)
    deployed: dict[str, str] = {}  # Pages project -> site files last deployed by this server

    def write_site(t: Tree, site: Site) -> tuple[Path, str, int]:
        """Write the Pages project folder; return it, its contents and how many were hidden."""
        page, hidden = share_page(t, site.hide_living, photos=bool(site.photos))
        written = site_files(page, site)
        folder = store.root / "exports" / f"{slugify(t.name)}-site"
        for name, content in written.items():
            path = folder / name
            path.parent.mkdir(parents=True, exist_ok=True)
            # Background updates can rewrite these while a deploy reads them.
            write_atomic(path, content)
        return folder, json.dumps(written, sort_keys=True), hidden

    def refresh(name: str) -> None:
        t = store.load(name)
        if not (t.site and t.site.keep_updated):
            return
        folder, contents, _ = write_site(t, t.site)
        if deployed.get(t.site.project) != contents:
            deploy(folder, t.site.project, create=False)
            deployed[t.site.project] = contents

    updater = Updater(refresh, publish_delay)
    store.on_change = updater.schedule
    atexit.register(updater.flush)

    @mcp.tool(annotations=READ)
    def list_trees() -> list[dict]:
        """List all family trees with their size, and the link where each is published."""
        found = []
        for t in store.trees():
            if not isinstance(t, Tree):
                found.append({"file": t, "error": "Unreadable file. Fix it or restore with undo."})
                continue
            entry = {"name": t.name, "description": t.description, "people": len(t.people)}
            if t.site:
                entry["site"] = t.site.url
                if error := updater.errors.get(t.name):
                    entry["site_error"] = error
            found.append(entry)
        return found

    @mcp.tool(annotations=WRITE)
    def create_tree(name: str, description: str = "") -> dict:
        """Create a new, empty family tree."""
        tree = store.create(name, description)
        return {"name": tree.name, "description": tree.description}

    @mcp.tool(annotations=WRITE)
    def rename_tree(tree: TreeName, new_name: str) -> dict:
        """Rename a tree. People, backups and relationships are kept."""
        renamed = store.rename(tree, new_name)
        return {"name": renamed.name, "people": len(renamed.people)}

    @mcp.tool(annotations=DELETE)
    def delete_tree(tree: TreeName) -> str:
        """Delete a family tree and everyone in it. It can be restored with undo."""
        store.delete(tree)
        return f"Deleted tree '{tree}'. Call undo with this tree name to restore it."

    @mcp.tool(annotations=DELETE)
    def undo(tree: TreeName) -> dict:
        """Revert the tree's most recent change, or restore it if it was deleted.

        Call repeatedly to step further back. Undone changes cannot be redone.
        """
        restored, remaining = store.undo(tree)
        return {"tree": restored.name, "people": len(restored.people), "undos_left": remaining}

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
    def add_people(tree: TreeName, people: list[NewPerson]) -> dict:
        """Add many people and their parent, partner and sibling links in one call.

        Prefer this over repeated add_person calls when entering a family. Each entry can
        link to others in the batch by their ref (or name) and to existing people by id.
        All entries are added, or none are if any link is invalid.
        """
        with store.edit(tree) as t:
            existing = {p.name.casefold(): p.id for p in t.people.values()}
            ids = t.add_people(people)
        duplicates = [
            {"new_id": ids[p.ref or p.name], "existing_id": existing[p.name.casefold()]}
            for p in people
            if p.name.casefold() in existing
        ]
        return {"ids": ids, "possible_duplicates": duplicates}

    @mcp.tool(annotations=WRITE)
    def update_person(
        tree: TreeName,
        person_id: PersonId,
        name: str | None = None,
        sex: SexChange = None,
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
    def merge_people(tree: TreeName, keep_id: PersonId, duplicate_id: PersonId) -> dict:
        """Merge a duplicate into keep_id, then remove the duplicate.

        Fills keep_id's missing details from the duplicate and moves its parents, partners
        and children. Also use it to replace a placeholder parent with the real person.
        """
        with store.edit(tree) as t:
            t.merge(keep_id, duplicate_id)
            return t.profile(keep_id)

    @mcp.tool(annotations=DELETE)
    def remove_person(tree: TreeName, person_id: PersonId) -> str:
        """Remove a person and all of their relationships."""
        with store.edit(tree) as t:
            name = t.get(person_id).name
            t.remove_person(person_id)
        return f"Removed {name}."

    @mcp.tool(annotations=WRITE)
    def add_relationship(
        tree: TreeName,
        person_id: PersonId,
        relation: Relation,
        relative_id: PersonId,
        status: PartnerStatus | None = None,
        marriage_date: Text = None,
        marriage_place: Text = None,
        divorce_date: Text = None,
    ) -> dict:
        """Record that relative_id is person_id's parent, child, partner or sibling.

        Example: relation="parent", person_id="ann", relative_id="bob" means Bob is Ann's parent.
        For partners, optionally record status and marriage details; call again to update them.
        Siblings get the same parents, with a placeholder parent if neither has any.
        """
        with store.edit(tree) as t:
            t.link(
                person_id,
                relation,
                relative_id,
                status=status,
                marriage_date=marriage_date,
                marriage_place=marriage_place,
                divorce_date=divorce_date,
            )
            return t.profile(person_id)

    @mcp.tool(annotations=DELETE)
    def remove_relationship(
        tree: TreeName, person_id: PersonId, relation: Relation, relative_id: PersonId
    ) -> dict:
        """Remove a parent, child or partner link. To separate siblings, remove a parent link."""
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
        person_id: DiagramFocus = None,
        view: View = "both",
        generations: int | None = None,
    ) -> str:
        """Draw the tree as a Mermaid flowchart. Show the result to the user in a ```mermaid block.

        Couples join at a dot above their children, who are ordered by birth date. Colors show sex
        (blue male, pink female, gray unknown), dashed faded boxes are deceased, and an orange
        border marks person_id. For large trees, pass person_id and generations.
        """
        return mermaid(store.load(tree), person_id, view, generations)

    @mcp.tool(annotations=WRITE)
    def export_gedcom(tree: TreeName) -> dict:
        """Save the tree as a GEDCOM 5.5.1 (.ged) file for import into other genealogy apps.

        Returns the file path; give it to the user rather than reading the file into the chat.
        """
        t = store.load(tree)
        path = _export(f"{slugify(t.name)}.ged", to_gedcom(t))
        return {"path": str(path), "people": len(t.people)}

    @mcp.tool(annotations=WRITE)
    def export_html(tree: TreeName, hide_living: bool = True) -> dict:
        """Save a read-only, interactive web page of the tree as a local file, without publishing.

        To put it online, use publish_site instead.
        """
        t = store.load(tree)
        page, hidden = share_page(t, hide_living)
        return {"file": str(_export(f"{slugify(t.name)}.html", page)), "hidden_living": hidden}

    @mcp.tool(annotations=ToolAnnotations(destructive_hint=False, open_world_hint=True))
    def publish_site(tree: TreeName, hide_living: bool = True, keep_updated: bool = True) -> dict:
        """Publish a read-only, interactive page of the tree to a free link anyone can open.

        Viewers can browse the tree, search, and tap anyone for their details and family.
        The tree itself can't be edited there, but anyone with the returned photo_code can add,
        change or remove photos; give the code to the user to share with family. hide_living
        removes birth dates, places and notes of people who may be alive. With keep_updated, the
        page is republished automatically once edits pause for 30 seconds; pass
        keep_updated=False to publish once and stop updating. Uses Cloudflare Pages and Workers
        KV: the first time, the user runs `npx wrangler login` in a terminal.
        """
        t = store.load(tree)
        project = t.site.project if t.site else slugify(t.name)[:58].strip("-")
        site = Site(
            project=project,
            url=t.site.url if t.site else "",
            hide_living=hide_living,
            keep_updated=keep_updated,
            photos=t.site.photos if t.site else None,
            edit_code=(t.site.edit_code if t.site else None) or new_code(),
        )
        folder = store.root / "exports" / f"{slugify(t.name)}-site"
        folder.mkdir(parents=True, exist_ok=True)
        site.photos = site.photos or photo_store(folder, project)
        folder, contents, hidden = write_site(t, site)
        site.url = deploy(folder, project)
        deployed[project] = contents
        with store.edit(tree) as current:
            current.site = site
        return {
            "url": site.url,
            "hidden_living": hidden,
            "keep_updated": keep_updated,
            "photo_code": site.edit_code,
            "note": "Anyone with the link can view it; adding or removing photos needs the "
            "photo code. To restrict viewing, see the README.",
        }

    @mcp.tool(annotations=ToolAnnotations(destructive_hint=False, open_world_hint=True))
    def change_photo_code(tree: TreeName, code: str | None = None) -> dict:
        """Replace the code needed to add, change or remove photos on the published site.

        Omit code to generate a new one. The old code stops working once the site updates.
        """
        t = store.load(tree)
        if not (t.site and t.site.photos):
            raise ToolError("Publish the site with publish_site first.")
        code = (code or new_code()).strip().lower()
        if len(code) < 6:
            raise ToolError("Use a code of at least 6 characters.")
        site = t.site.model_copy(update={"edit_code": code})
        folder, contents, _ = write_site(t, site)
        deploy(folder, site.project, create=False)
        deployed[site.project] = contents
        with store.edit(tree) as current:
            current.site = site
        return {"url": site.url, "photo_code": code}

    def _export(filename: str, content: str) -> Path:
        path = store.root / "exports" / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    return mcp


def main() -> None:
    root = os.environ.get("FAMILY_TREE_DIR", Path.home() / ".family-tree-mcp")
    create_server(Store(Path(root))).run(show_banner=False)
