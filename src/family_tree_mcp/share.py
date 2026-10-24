"""Build a self-contained, read-only web page of a tree for sharing."""

import datetime
import html
import json
import re
from importlib.resources import files

from family_tree_mcp.store import Collection, Family
from family_tree_mcp.tree import Site, Tree

ASSETS = files("family_tree_mcp")


def share_page(tree: Tree, site: Site, families: list[Family]) -> tuple[str, int]:
    """Return the page HTML and how many living people had their details hidden.

    Hiding also drops marriage dates and places for couples where either may be living. People
    whose details were hidden are marked `private` so the page can say so. With photos, the page
    shows and edits photos through the site's /api/photos function.
    """
    public = tree.model_copy(deep=True)
    hidden: list[str] = []
    if site.hide_living:
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
    for family in sorted(families, key=lambda t: t.name.casefold()):
        if family.id != tree.id:
            for pid in set(family.members) & data["people"].keys():
                data["people"][pid].setdefault("other_trees", []).append(
                    {"id": family.id, "name": family.name}
                )
    data["site_name"] = site.name
    if site.photos:
        data["photos"] = True
    embedded = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    options = []
    for family in sorted(families, key=lambda t: t.name.casefold()):
        current = ' aria-current="page"' if family.id == tree.id else ""
        options.append(
            f'<li><a href="/trees/{family.id}/"{current}>{html.escape(family.name)}</a></li>'
        )
    switch = (
        f'<span class="tree-crumb"><span class="divider" aria-hidden="true">/</span>'
        f'<a class="current-tree" href="/trees/{tree.id}/" title="Reset tree view">'
        f'{html.escape(tree.name)}</a><span class="tree-picker">'
        '<button id="tree-switch" aria-label="Switch family tree" aria-expanded="false" '
        'aria-controls="tree-options" title="Switch family tree">'
        '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">'
        '<path d="m6 9 6 6 6-6"/></svg></button>'
        f'<ul id="tree-options" class="tree-options" aria-label="Family trees" hidden>'
        f"{''.join(options)}</ul></span></span>"
    )
    page = _render(
        "share.html",
        {
            "__LAYOUT_ENGINE__": ASSETS.joinpath("vendor/elk.bundled.js").read_text(
                encoding="utf-8"
            ),
            "__LAYOUT_JS__": ASSETS.joinpath("layout.js").read_text(encoding="utf-8"),
            "__SHARE_JS__": ASSETS.joinpath("share.js").read_text(encoding="utf-8"),
            "__TITLE__": html.escape(tree.name),
            "__SHELL_CSS__": ASSETS.joinpath("shell.css").read_text(encoding="utf-8"),
            "__HEADER__": _header(
                site,
                _people_count(len(tree.people)),
                switch,
                ASSETS.joinpath("search.html").read_text(encoding="utf-8"),
            ),
            "__DATA__": embedded,
        },
    )
    return page, len(hidden)


def website_files(collection: Collection, site: Site) -> tuple[dict[str, str], int]:
    """Build one chooser plus a stable UUID route per tree; never embed global records."""
    pages: dict[str, str] = {}
    entries = []
    hidden = 0
    for family in sorted(collection.trees.values(), key=lambda t: t.name.casefold()):
        tree = collection.project(family.id)
        page, count = share_page(tree, site, list(collection.trees.values()))
        pages[f"trees/{tree.id}/index.html"] = page
        hidden += count
        entries.append(
            f'<li><a class="tree-card" href="/trees/{tree.id}/"><h3>{html.escape(tree.name)}</h3>'
            f"<dl><div><dt>People</dt><dd>{len(tree.people)}</dd></div></dl></a></li>"
        )
    listing = (
        '<ul class="trees">' + "".join(entries) + "</ul>"
        if entries
        else "<p>No family trees yet.</p>"
    )
    pages["index.html"] = _render(
        "home.html",
        {
            "__TITLE__": html.escape(site.name),
            "__TREES__": listing,
            "__TREE_COUNT__": str(len(collection.trees)),
            "__SHELL_CSS__": ASSETS.joinpath("shell.css").read_text(encoding="utf-8"),
            "__HEADER__": _header(site),
        },
    )
    return pages, hidden


def _people_count(count: int) -> str:
    return f"{count} {'person' if count == 1 else 'people'}"


def _header(site: Site, count: str = "", switch: str = "", search: str = "") -> str:
    return _render(
        "header.html",
        {
            "__SITE_NAME__": html.escape(site.name),
            "__COUNT__": f'<div class="count" id="count">{count}</div>' if count else "",
            "__TREE_SWITCH__": switch,
            "__SEARCH__": search,
        },
    )


def _render(template: str, values: dict[str, str]) -> str:
    # Substitute once: names containing template tokens are ordinary user text.
    return re.sub(
        r"__[A-Z_]+__",
        lambda match: values[match.group()],
        ASSETS.joinpath(template).read_text(encoding="utf-8"),
    )


def _maybe_living(birth_date: str | None, death_date: str | None) -> bool:
    """Treat anyone without a death date as living unless born over 100 years ago."""
    if death_date:
        return False
    match = re.search(r"\d{4}", birth_date or "")
    return not match or int(match.group()) > datetime.date.today().year - 100
