"""MCP tools for building and reasoning over family trees."""

import atexit
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Annotated, Literal

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from mcp.types import ToolAnnotations
from pydantic import Field

from family_tree_mcp.diagram import View, mermaid
from family_tree_mcp.gedcom import to_gedcom
from family_tree_mcp.publish import Updater, deploy, new_code, photo_store, site_files
from family_tree_mcp.share import website_files
from family_tree_mcp.store import Collection, Store, write_atomic
from family_tree_mcp.tree import (
    LinkChange,
    NewPerson,
    PartnerStatus,
    PersonChange,
    Relation,
    Sex,
    Site,
    Tree,
    slugify,
)

INSTRUCTIONS = """\
Manage one collection of shared people and relationships. Trees are named membership lists;
people and trees have immutable UUIDs. Search find_people WITHOUT tree before adding a person;
use set_tree_members to reuse an existing person across trees. Editing people or relationships
applies everywhere. Removing membership does not delete records. remove_person and merge_people
are collection-wide; undo reverses the most recent collection transaction, across all trees.
Relationships are visible in a tree only when both people are members. No automatic inclusion
of relatives. The website always starts with a chooser and includes every collection tree.
Configure its name/project with configure_website; publish_site publishes the whole site.

People are linked by two kinds of edges:
parent (at most two per person) and partner (optionally married or divorced, with
dates). Children, siblings, cousins, in-laws, step-relations and every other
relation are derived from those edges.

Building: call find_people first to avoid duplicates. Enter families with add_people
(one call for many people and their links); use add_person and add_relationship for
single changes, and update_people for many changes to existing people (renames, details,
links) as one undo step. A partner is never assumed to be a parent: when a child lists only
one of a couple as a parent, edits return a "check" note; ask the user before linking the
other. Run check_tree after large edits to review these, duplicates and placeholders.
Linking two people as "sibling" gives them shared parents, adding a placeholder parent if
neither has one. If someone was added twice, or a placeholder turns out to be a known
person, use merge_people.

Exploring: get_relationship names how two people are related; get_person,
get_ancestors and get_descendants list family. Children and siblings are listed
oldest first when birth dates are known.

Sharing: get_diagram returns Mermaid to display in a ```mermaid block; export_gedcom
writes a file for Ancestry, FamilySearch, MyHeritage, Gramps etc. To share with family,
call publish_site once: it puts a read-only page online and then updates it automatically
as the collection changes. Family can add photos on the page with the photo code publish_site
returns; change_photo_code replaces it.

Dates are free text; prefer ISO format (YYYY, YYYY-MM or YYYY-MM-DD).
Every change is backed up: if you make a mistake, or the user asks to revert, use undo.
"""

READ = ToolAnnotations(read_only_hint=True, open_world_hint=False)
WRITE = ToolAnnotations(destructive_hint=False, open_world_hint=False)
DELETE = ToolAnnotations(destructive_hint=True, open_world_hint=False)

TreeName = Annotated[
    str, Field(description="Stable tree UUID (preferred) or exact name, as shown by list_trees.")
]
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

    def write_site(data: Collection, site: Site) -> tuple[Path, str, int]:
        pages, hidden = website_files(data, site)
        written = site_files(pages, site)
        folder = store.root / "exports" / "website"
        # Remove only generated HTML, so deleted trees cannot linger in deployments.
        public = folder / "public"
        if public.exists():
            for old in public.rglob("*.html"):
                old.unlink()
        for name, content in written.items():
            path = folder / name
            path.parent.mkdir(parents=True, exist_ok=True)
            write_atomic(path, content)
        return folder, json.dumps(written, sort_keys=True), hidden

    def refresh(_key: str) -> None:
        with store.lock():
            data = store.collection()
            if not (data.site and data.site.keep_updated):
                return
            folder, contents, _ = write_site(data, data.site)
            if deployed.get(data.site.project) != contents:
                deploy(folder, data.site.project, create=False)
                deployed[data.site.project] = contents

    updater = Updater(refresh, publish_delay)
    store.on_change = updater.schedule
    atexit.register(updater.flush)

    @mcp.tool(annotations=READ)
    def list_trees() -> list[dict]:
        """List all trees with stable UUIDs, descriptions and membership counts."""
        return [
            {"id": t.id, "name": t.name, "description": t.description, "people": len(t.people)}
            for t in store.trees()
        ]

    @mcp.tool(annotations=READ)
    def get_website() -> dict:
        """Read site identity and publication status; never exposes the photo editing code."""
        site = store.collection().site
        return (
            {**site.model_dump(exclude={"edit_code"}, exclude_none=True), **updater.status("site")}
            if site
            else {"configured": False}
        )

    @mcp.tool(annotations=WRITE)
    def configure_website(name: str, project: str) -> dict:
        """Set website title and Cloudflare project independently of tree names.

        Choose project before the first publication. Changing a published project requires
        a separate installation so its photo storage and URL cannot be reassigned by accident.
        """
        name = name.strip()
        if not name or not project or slugify(project) != project or len(project) > 58:
            raise ToolError(
                "Supply a website name and a lowercase project slug (max 58 characters)."
            )
        with store.transaction() as data:
            if data.site:
                if data.site.project != project:
                    raise ToolError(
                        "The configured project cannot be changed. Use a new collection."
                    )
                data.site.name = name
            else:
                data.site = Site(name=name, project=project, url="", keep_updated=False)
        return {"name": name, "project": project}

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
        """Rename a tree. People, backups and relationships are kept."""
        renamed = store.rename(tree, new_name)
        return {"id": renamed.id, "name": renamed.name, "people": len(renamed.people)}

    @mcp.tool(annotations=DELETE)
    def delete_tree(tree: TreeName) -> str:
        """Delete only a tree definition. Shared people remain; undo restores the tree."""
        store.delete(tree)
        return f"Deleted tree '{tree}'. Call undo to restore it."

    @mcp.tool(annotations=DELETE)
    def undo() -> dict:
        """Revert the last collection-wide transaction, including all affected trees.

        This is global history, not per-tree history. Undone changes cannot be redone.
        """
        return {"undos_left": store.undo()}

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

        Use instead of repeated update_person, add_relationship or remove_relationship calls.
        Each link reads "relative_id is person_id's relation", as in add_relationship; set
        remove=true to remove it. Everything applies, or nothing does if any entry fails, and
        undo reverts it all in one step. To add new people, use add_people.
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
            return t.profile(person_id) | checks(t, {person_id, relative_id})

    @mcp.tool(annotations=DELETE)
    def remove_relationship(
        tree: TreeName, person_id: PersonId, relation: Relation, relative_id: PersonId
    ) -> dict:
        """Remove a parent, child or partner link. To separate siblings, remove a parent link."""
        with store.edit(tree) as t:
            t.unlink(person_id, relation, relative_id)
            return t.profile(person_id)

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
    def export_website(hide_living: bool = True) -> dict:
        """Build the complete site locally, including chooser and every tree, without deploying."""
        with store.lock():
            data = store.collection()
            if not data.site:
                raise ToolError("Call configure_website first.")
            site = data.site.model_copy(update={"hide_living": hide_living})
            folder, _, hidden = write_site(data, site)
            return {"folder": str(folder / "public"), "hidden_living": hidden}

    @mcp.tool(annotations=ToolAnnotations(destructive_hint=False, open_world_hint=True))
    def publish_site(hide_living: bool = True, keep_updated: bool = True) -> dict:
        """Publish the ENTIRE configured website: chooser and all trees.

        First call configure_website. All collection trees are public; living dates, places
        and notes are hidden by default. Automatic updates rebuild the entire site after edits
        pause. Publishing requires Cloudflare authentication; photos use a site-wide code.
        """
        with store.lock():
            data = store.collection()
            if not data.site:
                raise ToolError("Call configure_website first.")
            site = data.site.model_copy(
                update={"hide_living": hide_living, "keep_updated": keep_updated}
            )
            folder = store.root / "exports" / "website"
            folder.mkdir(parents=True, exist_ok=True)
            site.edit_code = site.edit_code or new_code()
            site.photos = site.photos or photo_store(folder, site.project)
            folder, contents, hidden = write_site(data, site)
            site.url = deploy(folder, site.project)
            deployed[site.project] = contents
            updater.errors.pop("site", None)
            updater.published["site"] = datetime.now().astimezone()
            with store.transaction() as current:
                current.site = site
            return {
                "url": site.url,
                "hidden_living": hidden,
                "keep_updated": keep_updated,
                "photo_code": site.edit_code,
            }

    @mcp.tool(annotations=ToolAnnotations(destructive_hint=False, open_world_hint=True))
    def change_photo_code(code: str | None = None) -> dict:
        """Replace the site-wide photo editing code and republish the complete website."""
        with store.lock():
            data = store.collection()
            if not (data.site and data.site.photos):
                raise ToolError("Publish the site with publish_site first.")
            code = (code or new_code()).strip().lower()
            if len(code) < 6:
                raise ToolError("Use a code of at least 6 characters.")
            site = data.site.model_copy(update={"edit_code": code})
            folder, contents, _ = write_site(data, site)
            deploy(folder, site.project, create=False)
            deployed[site.project] = contents
            with store.transaction() as current:
                current.site = site
            return {"url": site.url, "photo_code": code}

    def checks(t: Tree, people: set[str]) -> dict:
        """One-parent children involving these people, as notes for an edit's result."""
        notes = [issue["summary"] for issue in t.check(people)]
        return {"check": notes} if notes else {}

    def _export(filename: str, content: str) -> Path:
        path = store.root / "exports" / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    return mcp


def main() -> None:
    root = os.environ.get("FAMILY_TREE_DIR", Path.home() / ".family-tree-mcp")
    create_server(Store(Path(root))).run(show_banner=False)
