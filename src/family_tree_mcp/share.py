"""Build a self-contained, read-only web page of a tree for sharing."""

import datetime
import html
import json
import re
from importlib.resources import files

from family_tree_mcp.tree import Tree

ASSETS = files("family_tree_mcp")


def share_page(tree: Tree, hide_living: bool = True, photos: bool = False) -> tuple[str, int]:
    """Return the page HTML and how many living people had their details hidden.

    Hiding also drops marriage dates and places for couples where either may be living. People
    whose details were hidden are marked `private` so the page can say so. With photos, the page
    shows and edits photos through the site's /api/photos function.
    """
    public = tree.model_copy(deep=True, update={"site": None})
    hidden: list[str] = []
    if hide_living:
        living = {p.id for p in public.people.values() if _maybe_living(p.birth_date, p.death_date)}
        for person in public.people.values():
            if person.id in living and (person.birth_date or person.birth_place or person.notes):
                person.birth_date = person.birth_place = person.notes = None
                hidden.append(person.id)
        for key, details in public.partnerships.items():
            if living & set(key.split("+")):
                details.marriage_date = details.marriage_place = details.divorce_date = None
    data = public.model_dump(mode="json", exclude_none=True)
    for pid in hidden:
        data["people"][pid]["private"] = True
    if photos:
        data["photos"] = True
    embedded = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    page = (
        ASSETS.joinpath("share.html")
        .read_text(encoding="utf-8")
        .replace("__SHARE_JS__", ASSETS.joinpath("share.js").read_text(encoding="utf-8"))
        .replace("__TITLE__", html.escape(tree.name))
        .replace("__DATA__", embedded)
    )
    return page, len(hidden)


def _maybe_living(birth_date: str | None, death_date: str | None) -> bool:
    """Treat anyone without a death date as living unless born over 100 years ago."""
    if death_date:
        return False
    match = re.search(r"\d{4}", birth_date or "")
    return not match or int(match.group()) > datetime.date.today().year - 100
