"""Render a family tree, or one person's part of it, as a Mermaid flowchart."""

import base64
import json
import re
import zlib
from typing import Literal

from family_tree_mcp.tree import Person, Tree

View = Literal["ancestors", "descendants", "both"]

STYLES = """\
    classDef male fill:#dbeafe,stroke:#2563eb,color:#0f172a
    classDef female fill:#fce7f3,stroke:#db2777,color:#0f172a
    classDef unknown fill:#f1f5f9,stroke:#64748b,color:#0f172a
    classDef deceased stroke-dasharray:5 3,fill-opacity:0.6
    classDef focus stroke:#d97706,stroke-width:4px
    classDef union fill:#64748b,stroke:#64748b"""


def mermaid(
    tree: Tree, person_id: str | None = None, view: View = "both", generations: int | None = None
) -> str:
    ids = _select(tree, person_id, view, generations)
    node = {pid: f"p{i}" for i, pid in enumerate(ids)}
    lines = ["---", f"title: {json.dumps(tree.name, ensure_ascii=False)}", "---", "flowchart TD"]
    lines += [f'    {node[pid]}["{_label(tree.people[pid])}"]' for pid in ids]

    # Couples (partners, or a child's two parents) meet at a small union node above their children;
    # divorced couples join it with dotted lines.
    unions: dict[frozenset[str], str] = {}

    def union(pair: frozenset[str]) -> str:
        if pair not in unions:
            unions[pair] = u = f"u{len(unions)}"
            lines.append(f"    {u}(( )):::union")
            a, b = sorted(pair, key=ids.index)
            details = tree.partnership(a, b)
            link = "-.-" if details and details.status == "divorced" else "---"
            lines.extend([f"    {node[a]} {link} {u}", f"    {node[b]} {link} {u}"])
        return unions[pair]

    for pid in ids:
        for partner in tree.people[pid].partners:
            if partner in node:
                union(frozenset((pid, partner)))
    for pid in ids:
        parents = frozenset(p for p in tree.people[pid].parents if p in node)
        if len(parents) == 2:
            lines.append(f"    {union(parents)} --> {node[pid]}")
        elif parents:
            lines.append(f"    {node[next(iter(parents))]} --> {node[pid]}")

    lines.append(STYLES)
    for cls in ("male", "female", "unknown", "deceased", "focus"):
        if members := [node[pid] for pid in ids if cls in _classes(tree.people[pid], person_id)]:
            lines.append(f"    class {','.join(members)} {cls}")
    return "\n".join(lines)


def mermaid_live_url(source: str) -> str:
    """Link that opens the diagram in the mermaid.live editor, using its pako URL format."""
    state = {
        "code": source,
        "mermaid": '{"theme": "default"}',
        "updateDiagram": True,
        "rough": False,
    }
    packed = zlib.compress(json.dumps(state).encode(), 9)
    return "https://mermaid.live/edit#pako:" + base64.urlsafe_b64encode(packed).decode().rstrip("=")


def _select(tree: Tree, person_id: str | None, view: View, generations: int | None) -> list[str]:
    if person_id is None:
        return tree.by_birth(list(tree.people))
    tree.get(person_id)
    within = {person_id}
    if view != "descendants":
        within |= _near(tree.ancestors(person_id), generations)
    if view != "ancestors":
        descendants = _near(tree.descendants(person_id), generations) | {person_id}
        within |= descendants
        within |= {p for d in descendants for p in tree.people[d].partners}
    return tree.by_birth([pid for pid in tree.people if pid in within])


def _near(distances: dict[str, int], generations: int | None) -> set[str]:
    return {pid for pid, gen in distances.items() if generations is None or gen <= generations}


def _classes(person: Person, focus: str | None) -> set[str]:
    classes = {person.sex or "unknown"}
    if person.death_date:
        classes.add("deceased")
    if person.id == focus:
        classes.add("focus")
    return classes


def _label(person: Person) -> str:
    birth, death = _year(person.birth_date), _year(person.death_date)
    if birth and death:
        years = f"{birth}–{death}"
    elif birth or death:
        years = f"b. {birth}" if birth else f"d. {death}"
    else:
        return _escape(person.name)
    return f"{_escape(person.name)}<br/><small>{years}</small>"


def _year(date: str | None) -> str | None:
    if not date:
        return None
    match = re.search(r"\d{4}", date)
    return match.group() if match else _escape(date)


def _escape(text: str) -> str:
    return text.replace('"', "#quot;").replace("<", "#lt;").replace(">", "#gt;")
