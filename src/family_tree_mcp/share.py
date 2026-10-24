"""Build a self-contained, read-only web page of a tree for sharing."""

import datetime
import html
import re
from importlib.resources import files

from family_tree_mcp.tree import Tree

ASSETS = files("family_tree_mcp")


def share_page(tree: Tree, hide_living: bool = True) -> tuple[str, int]:
    """Return the page HTML and how many living people had their details hidden."""
    public = tree.model_copy(deep=True)
    hidden = 0
    if hide_living:
        for person in public.people.values():
            private = person.birth_date or person.birth_place or person.notes
            if private and _maybe_living(person.birth_date, person.death_date):
                person.birth_date = person.birth_place = person.notes = None
                hidden += 1
    data = public.model_dump_json(exclude_none=True).replace("</", "<\\/")
    page = (
        ASSETS.joinpath("share.html")
        .read_text(encoding="utf-8")
        .replace("__SHARE_JS__", ASSETS.joinpath("share.js").read_text(encoding="utf-8"))
        .replace("__TITLE__", html.escape(tree.name))
        .replace("__DATA__", data)
    )
    return page, hidden


def _maybe_living(birth_date: str | None, death_date: str | None) -> bool:
    """Treat anyone without a death date as living unless born over 100 years ago."""
    if death_date:
        return False
    match = re.search(r"\d{4}", birth_date or "")
    return not match or int(match.group()) > datetime.date.today().year - 100
