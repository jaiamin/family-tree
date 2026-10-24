import json
import shutil
import subprocess
from importlib.resources import files

import pytest

from family_tree_mcp.share import share_page
from family_tree_mcp.tree import Tree

RUNNER = """
const lib = require(process.argv[1]);
const { tree, viewports } = JSON.parse(require("fs").readFileSync(0, "utf8"));
const ids = Object.keys(tree.people);
console.log(JSON.stringify({
  children: ids.map((id) => lib.children(tree, id)),
  siblings: ids.map((id) => lib.siblings(tree, id)),
  half: ids.map((a) => ids.map((b) => a !== b && lib.halfSiblings(tree, a, b))),
  layouts: viewports.map((v) => lib.layout(tree, v)),
  connections: viewports.map((v) => lib.connections(tree, lib.layout(tree, v))),
}));
"""


@pytest.mark.skipif(not shutil.which("node"), reason="needs Node.js")
def test_page_logic_matches_python_and_lays_out_everyone(tree: Tree) -> None:
    tree.update_person("sis", birth_date="1990")
    tree.update_person("me", birth_date="c. 1995")
    tree.link("dad", "partner", "mom", status="married", marriage_date="1988")
    tree.link("dad", "partner", "ex", divorce_date="1985")
    # A second family married into the first, and a couple whose children stack.
    for name in ("In-law Dad", "Spouse", "Spouse Sib"):
        tree.add_person(name)
    tree.link("spouse", "parent", "in-law-dad")
    tree.link("spouse-sib", "parent", "in-law-dad")
    tree.link("cousin", "partner", "spouse")
    for name in ("Kid A", "Kid B", "Kid C"):
        tree.add_person(name)
        tree.link(name.lower().replace(" ", "-"), "parent", "sis")
    # A second child with the ex next to a childless full brother, and a partner who married in
    # to a family with children.
    tree.add_person("Brother")
    tree.link("brother", "parent", "dad")
    tree.link("brother", "parent", "mom")
    tree.add_person("Half Two")
    tree.link("half-two", "parent", "dad")
    tree.link("half-two", "parent", "ex")
    tree.add_person("Sis Husband")
    tree.link("sis", "partner", "sis-husband")
    tree.link("kid-a", "parent", "sis-husband")
    ids = list(tree.people)
    viewports = [{"width": w, "height": h} for w, h in ((1440, 800), (390, 760), (4000, 1200))]
    data = {"tree": tree.model_dump(exclude_none=True), "viewports": viewports}
    script = str(files("family_tree_mcp").joinpath("share.js"))
    result = subprocess.run(
        ["node", "-e", RUNNER, script], input=json.dumps(data), capture_output=True, text=True
    )
    assert result.returncode == 0, result.stderr
    js = json.loads(result.stdout)

    assert js["children"] == [tree.children(i) for i in ids]
    assert js["siblings"] == [tree.siblings(i) for i in ids]
    assert js["half"] == [[a != b and tree.half_siblings(a, b) for b in ids] for a in ids]
    for view, got, edges in zip(viewports, js["layouts"], js["connections"], strict=True):
        pos, card = got["pos"], got["card"]
        assert set(pos) == set(ids)
        assert got["portrait"] == (view["height"] > view["width"])
        boxes = sorted((p["x"], p["y"]) for p in pos.values())
        for i, (x, y) in enumerate(boxes):
            assert x >= 0 and x + card["w"] <= got["width"] + 0.5
            assert y >= 0 and y + card["h"] <= got["height"] + 0.5
            for x2, y2 in boxes[i + 1 :]:
                assert abs(x - x2) >= card["w"] or abs(y - y2) >= card["h"], "cards overlap"
        for pid in ids:
            if parents := tree.people[pid].parents:
                assert any(pos[pid]["y"] > pos[p]["y"] for p in parents)
        for pid in ids:
            for partner in tree.people[pid].partners:
                a, b = pos[pid], pos[partner]
                joined_cards = (
                    pid in got["pair"]
                    and partner in got["pair"]
                    and a["x"] == b["x"]
                    and abs(a["y"] - b["y"]) == card["h"]
                )
                assert joined_cards or any(
                    e["kind"] == "couple"
                    and e["className"] != "dot"
                    and set(e["people"]) == {pid, partner}
                    for e in edges
                ), "Partnership disappeared"
        # Every parent pair has a visible junction, with all shared children leaving it.
        for pid in ids:
            parents = tree.people[pid].parents
            if len(parents) != 2:
                continue
            dot = next(
                e for e in edges if e["className"] == "dot" and set(e["people"]) == set(parents)
            )
            child = next(e for e in edges if e["kind"] == "child" and e["people"][0] == pid)
            start = child["d"].split("V")[0][1:]
            dot_start = dot["d"].split("a")[0][1:]
            x, y = map(float, start.split(","))
            dx, dy = map(float, dot_start.split(","))
            assert x == dx + 3.5 and y == dy, "Child disconnected from its parents' junction"
        # Couples stacked in a column form one joined card.
        stacked = 0
        for pid in ids:
            for other in tree.people[pid].partners:
                a, b = pos[pid], pos[other]
                if a["x"] == b["x"] and abs(a["y"] - b["y"]) == card["h"]:
                    stacked += 1
                    assert pid in got["pair"] and other in got["pair"]
        assert stacked or view["height"] < view["width"]
        # A column of stacked children never mixes children of different couples.
        runs: dict[float, set[frozenset[str]]] = {}
        for pid, at in got["spine"].items():
            runs.setdefault(at["x"], set()).add(frozenset(tree.people[pid].parents))
        assert all(len(couples) == 1 for couples in runs.values())


def test_share_page_hides_living_details_and_embeds_safely() -> None:
    t = Tree(name="Smiths")
    t.add_person("Old Gran", birth_date="1890", notes="Kept")
    t.add_person("Late Grandpa", birth_date="1950", death_date="2010", birth_place="Pune")
    t.add_person("Living Me</script>", birth_date="1998", birth_place="Mumbai", notes="Private")
    t.link("old-gran", "partner", "late-grandpa", marriage_date="1970")
    t.link("living-me-script", "partner", "late-grandpa", marriage_date="2020")

    page, hidden = share_page(t)
    data = json.loads(page.split('type="application/json">')[1].split("</script>")[0])
    people = data["people"]
    assert hidden == 1
    assert (
        "birth_date" not in people["living-me-script"] and "notes" not in people["living-me-script"]
    )
    assert people["living-me-script"]["private"] is True and "private" not in people["late-grandpa"]
    assert people["late-grandpa"]["birth_place"] == "Pune" and people["old-gran"]["notes"] == "Kept"
    assert "__" not in page.replace("__proto__", "")
    assert data["partnerships"] == {
        "late-grandpa+old-gran": {"status": "married", "marriage_date": "1970"},
        "late-grandpa+living-me-script": {"status": "married"},
    }

    page, hidden = share_page(t, hide_living=False)
    assert hidden == 0 and "Mumbai" in page and '"private"' not in page


@pytest.mark.skipif(not shutil.which("node"), reason="needs Node.js")
def test_couple_in_different_branches_has_visible_join_and_shared_children() -> None:
    """Both parents have ancestry: their marriage must stay visible across rows."""
    script = str(files("family_tree_mcp").joinpath("share.js"))
    result = subprocess.run(
        [
            "node",
            "-e",
            """
const { connections } = require(process.argv[1]);
const tree = { people: {
  divya: { parents: [], partners: ['shashank'] },
  shashank: { parents: [], partners: ['divya'] },
  nirav: { parents: ['divya', 'shashank'], partners: [] },
  ami: { parents: ['divya', 'shashank'], partners: [] },
} };
const geometry = {
  pos: {divya: {x: 0, y: 0}, shashank: {x: 238, y: 112},
        nirav: {x: 256, y: 172}, ami: {x: 256, y: 300}},
  hang: {nirav: {x: 247, y: 164}, ami: {x: 247, y: 164}},
  spine: {}, pair: {}, family: {nirav: 'shashank', ami: 'shashank'},
  card: {w: 172, h: 52}, gap: {stack: 8, row: 56},
};
console.log(JSON.stringify(connections(tree, geometry)));
""",
            script,
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    edges = json.loads(result.stdout)
    couple = [e for e in edges if e["kind"] == "couple"]
    assert len(couple) == 2, "Marriage needs a permanent line and a shared-parent dot"
    dot = next(e for e in couple if e["className"] == "dot")
    assert set(dot["people"]) == {"divya", "shashank"}
    children = [e for e in edges if e["kind"] == "child"]
    assert len(children) == 2
    assert all(e["d"].startswith("M205,138") for e in children), (
        "Children must leave the shared join"
    )
