"""Export a family tree as GEDCOM 5.5.1, the format genealogy sites and apps import."""

import datetime
import re

from family_tree_mcp.tree import Tree

MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
SEX = {"male": "M", "female": "F"}


def to_gedcom(tree: Tree) -> str:
    indi = {pid: f"@I{i}@" for i, pid in enumerate(tree.people, 1)}

    # A GEDCOM family is a couple (or lone parent) plus their children.
    families: dict[frozenset[str], list[str]] = {}
    for person in tree.people.values():
        for partner in person.partners:
            families.setdefault(frozenset((person.id, partner)), [])
        if person.parents:
            families.setdefault(frozenset(person.parents), []).append(person.id)
    fam = {key: f"@F{i}@" for i, key in enumerate(families, 1)}

    lines = [
        "0 HEAD",
        "1 SOUR family-tree-mcp",
        "1 SUBM @U1@",
        "1 GEDC",
        "2 VERS 5.5.1",
        "2 FORM LINEAGE-LINKED",
        "1 CHAR UTF-8",
        "0 @U1@ SUBM",
        "1 NAME family-tree-mcp",
    ]
    for person in tree.people.values():
        lines += [f"0 {indi[person.id]} INDI", f"1 NAME {_name(person.name)}"]
        lines.append(f"1 SEX {SEX.get(person.sex or '', 'U')}")
        lines += _event("BIRT", person.birth_date, person.birth_place)
        lines += _event("DEAT", person.death_date, None)
        if person.notes:
            lines += _text(1, "NOTE", person.notes)
        for key, ref in fam.items():
            if person.id in families[key]:
                lines.append(f"1 FAMC {ref}")
            if person.id in key:
                lines.append(f"1 FAMS {ref}")
    for key, children in families.items():
        lines.append(f"0 {fam[key]} FAM")
        for role, pid in _spouses(tree, key):
            lines.append(f"1 {role} {indi[pid]}")
        lines += [f"1 CHIL {indi[c]}" for c in tree.by_birth(children)]
        if len(key) == 2 and (details := tree.partnership(*key)):
            lines += _event("MARR", details.marriage_date, details.marriage_place)
            if details.status == "divorced" or details.divorce_date:
                lines += _event("DIV", details.divorce_date, None)
    lines.append("0 TRLR")
    return "\n".join(lines) + "\n"


def _event(tag: str, date: str | None, place: str | None) -> list[str]:
    if not (date or place):
        return []
    return (
        [f"1 {tag}"]
        + ([f"2 DATE {_date(date)}"] if date else [])
        + ([f"2 PLAC {place}"] if place else [])
    )


def _spouses(tree: Tree, couple: frozenset[str]) -> list[tuple[str, str]]:
    """GEDCOM 5.5.1 only has HUSB and WIFE, so assign them by sex where known."""
    order = {"male": 0, None: 1, "female": 2}
    people = sorted(
        (tree.people[pid] for pid in couple),
        key=lambda p: (order[p.sex], list(tree.people).index(p.id)),
    )
    if len(people) == 1:
        return [("WIFE" if people[0].sex == "female" else "HUSB", people[0].id)]
    return [("HUSB", people[0].id), ("WIFE", people[1].id)]


def _name(name: str) -> str:
    *given, surname = name.replace("/", " ").split() or ["Unknown"]
    return f"{' '.join(given)} /{surname}/" if given else surname


def _date(date: str) -> str:
    """Convert ISO dates (YYYY, YYYY-MM, YYYY-MM-DD); keep anything else as a date phrase."""
    date = date.strip()
    if match := re.fullmatch(r"(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?", date):
        year, month, day = match.groups()
        try:
            datetime.date(int(year), int(month or 1), int(day or 1))
        except ValueError:
            return f"({date})"
        parts = [str(int(day)) if day else "", MONTHS[int(month) - 1] if month else "", year]
        return " ".join(p for p in parts if p)
    return f"({date})"


def _text(level: int, tag: str, text: str) -> list[str]:
    """Split text into CONT lines at newlines and CONC lines to stay under the line limit."""
    lines = []
    for i, line in enumerate(text.splitlines() or [""]):
        prefix = f"{level} {tag}" if i == 0 else f"{level + 1} CONT"
        first, *rest = _chunks(line)
        lines.append(f"{prefix} {first}" if first else prefix)
        lines += [f"{level + 1} CONC {chunk}" for chunk in rest]
    return lines


def _chunks(line: str, size: int = 200) -> list[str]:
    """Readers may trim spaces around CONC breaks, so never split next to a space."""
    chunks = []
    while len(line) > size:
        cut = size
        while cut > 1 and " " in (line[cut - 1], line[cut]):
            cut -= 1
        chunks.append(line[:cut])
        line = line[cut:]
    return [*chunks, line]
