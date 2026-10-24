import pytest
from conftest import seed

from family_tree_mcp.gedcom import _date, to_gedcom
from family_tree_mcp.tree import Tree


def records(ged: str) -> dict[str, list[str]]:
    """Group GEDCOM lines by their level-0 record."""
    out: dict[str, list[str]] = {}
    for line in ged.splitlines():
        if line.startswith("0 "):
            key = line[2:]
            out[key] = []
        else:
            out[key].append(line)
    return out


@pytest.mark.parametrize(
    ("date", "expected"),
    [
        ("1950", "1950"),
        ("1950-03", "MAR 1950"),
        ("1950-03-07", "7 MAR 1950"),
        ("1931-02-29", "(1931-02-29)"),
        ("around 1920", "(around 1920)"),
    ],
)
def test_dates(date: str, expected: str) -> None:
    assert _date(date) == expected


def test_families_link_couples_children_and_lone_parents() -> None:
    t = Tree(name="T")
    for name, sex in [
        ("Ann Lee", "female"),
        ("Bo Lee", "male"),
        ("Cy Lee", None),
        ("Di", "female"),
    ]:
        seed(t, name, sex=sex)
    t.link("ann-lee", "partner", "bo-lee")
    t.link("cy-lee", "parent", "ann-lee")
    t.link("cy-lee", "parent", "bo-lee")
    t.link("di", "parent", "ann-lee")

    recs = records(to_gedcom(t))
    assert recs["@I1@ INDI"][:2] == ["1 NAME Ann /Lee/", "1 SEX F"]
    assert recs["@I4@ INDI"][:2] == ["1 NAME Di", "1 SEX F"]
    assert recs["@F1@ FAM"] == ["1 HUSB @I2@", "1 WIFE @I1@", "1 CHIL @I3@"]
    assert recs["@F2@ FAM"] == ["1 WIFE @I1@", "1 CHIL @I4@"]
    assert recs["@I3@ INDI"][-1] == "1 FAMC @F1@"
    assert list(recs)[0] == "HEAD" and list(recs)[-1] == "TRLR"


def test_long_notes_survive_line_limits() -> None:
    note = "First line\n" + "word " * 120 + "\n\nlast"
    t = Tree(name="T")
    seed(t, "Ann", notes=note)
    lines = records(to_gedcom(t))["@I1@ INDI"]

    rebuilt = ""
    for line in lines:
        _, tag, *value = line.split(" ", 2)
        value = value[0] if value else ""
        if tag == "NOTE":
            rebuilt = value
        elif tag == "CONT":
            rebuilt += "\n" + value
        elif tag == "CONC":
            assert not value.startswith(" ") and not rebuilt.endswith(" ")
            rebuilt += value
    assert rebuilt == note
    assert all(len(line) <= 255 for line in lines)


def test_marriages_and_divorces_become_family_events() -> None:
    t = Tree(name="T")
    for name in ("Ann", "Bo", "Cy"):
        seed(t, name)
    t.link("ann", "partner", "bo", marriage_date="1950-06-01", marriage_place="Pune")
    t.link("ann", "partner", "cy", status="divorced", divorce_date="1970")

    recs = records(to_gedcom(t))
    assert recs["@F1@ FAM"][2:] == ["1 MARR", "2 DATE 1 JUN 1950", "2 PLAC Pune"]
    assert recs["@F2@ FAM"][2:] == ["1 DIV", "2 DATE 1970"]


def test_at_signs_are_escaped() -> None:
    t = Tree(name="T")
    seed(t, "Ann @home", birth_place="Pune @ India", notes="x" * 199 + "@@ ann@example.com")
    text = to_gedcom(t)
    assert "1 NAME Ann /@@home/" in text and "2 PLAC Pune @@ India" in text
    for line in records(text)["@I1@ INDI"]:
        value = line.split(" ", 2)[2] if line.count(" ") > 1 else ""
        assert "@" not in value.replace("@@", "")
