import json
import shutil
import subprocess
from importlib.resources import files

import pytest
from conftest import seed

from family_tree_mcp.share import share_page
from family_tree_mcp.store import Family
from family_tree_mcp.tree import Site, Tree

RUNNER = """
const lib = require(process.argv[1]);
const input = JSON.parse(require("fs").readFileSync(0, "utf8"));
const { tree } = input;
(async () => {
const ids = Object.keys(tree.people);
const geometry = await lib.layout(tree, input.direction);
console.log(JSON.stringify({
  children: ids.map((id) => lib.children(tree, id)),
  siblings: ids.map((id) => lib.siblings(tree, id)),
  half: ids.map((a) => ids.map((b) => a !== b && lib.halfSiblings(tree, a, b))),
  geometry,
  edges: lib.connections(geometry),
}));
})().catch((e) => { console.error(e); process.exitCode = 1; });
"""


@pytest.mark.skipif(not shutil.which("node"), reason="needs Node.js")
@pytest.mark.parametrize("direction", ["DOWN", "RIGHT"])
def test_page_logic_matches_python_and_lays_out_everyone(tree: Tree, direction: str) -> None:
    tree.update_person("sis", birth_date="1990")
    tree.update_person("me", birth_date="c. 1995")
    tree.link("dad", "partner", "mom", status="married", marriage_date="1988")
    tree.link("dad", "partner", "ex", divorce_date="1985")
    # A second family married into the first, and a couple with several children.
    for name in ("In-law Dad", "Spouse", "Spouse Sib"):
        seed(tree, name)
    tree.link("spouse", "parent", "in-law-dad")
    tree.link("spouse-sib", "parent", "in-law-dad")
    tree.link("cousin", "partner", "spouse")
    for name in ("Kid A", "Kid B", "Kid C"):
        seed(tree, name)
        tree.link(name.lower().replace(" ", "-"), "parent", "sis")
    # A second child with the ex next to a childless full brother, and a partner who married in
    # to a family with children.
    seed(tree, "Brother")
    tree.link("brother", "parent", "dad")
    tree.link("brother", "parent", "mom")
    seed(tree, "Half Two")
    tree.link("half-two", "parent", "dad")
    tree.link("half-two", "parent", "ex")
    seed(tree, "Sis Husband")
    tree.link("sis", "partner", "sis-husband")
    tree.link("kid-a", "parent", "sis-husband")
    ids = list(tree.people)
    js = run_graph(tree, direction)

    assert js["children"] == [tree.children(i) for i in ids]
    assert js["siblings"] == [tree.siblings(i) for i in ids]
    assert js["half"] == [[a != b and tree.half_siblings(a, b) for b in ids] for a in ids]
    got, edges = js["geometry"], js["edges"]
    pos, card = got["pos"], got["card"]
    assert set(pos) == set(ids)
    boxes = sorted((p["x"], p["y"]) for p in got["nodes"])
    for i, (x, y) in enumerate(boxes):
        assert x >= 0 and x + card["w"] <= got["width"] + 0.5
        assert y >= 0 and y + card["h"] <= got["height"] + 0.5
        for x2, y2 in boxes[i + 1 :]:
            assert abs(x - x2) >= card["w"] or abs(y - y2) >= card["h"], "cards overlap"
    assert_clean_connections(got, edges)
    assert any(len(e["children"]) > 1 for e in edges if e["kind"] == "child")
    assert len(got["nodes"]) == len(ids)
    assert len({c["personId"] for c in got["nodes"]}) == len(ids)


def test_share_page_hides_living_details_and_embeds_safely() -> None:
    t = Tree(name="Smiths")
    seed(t, "Old Gran", birth_date="1890", notes="Kept")
    seed(t, "Late Grandpa", birth_date="1950", death_date="2010", birth_place="Pune")
    seed(t, "Living Me</script>", birth_date="1998", birth_place="Mumbai", notes="Private")
    t.link("old-gran", "partner", "late-grandpa", marriage_date="1970")
    t.link("living-me-script", "partner", "late-grandpa", marriage_date="2020")

    page, hidden = share_page(
        t, Site(name="Website", project="example", url=""), [Family(id=t.id, name=t.name)]
    )
    data = json.loads(page.split('type="application/json">')[1].split("</script>")[0])
    people = data["people"]
    assert hidden == 1
    assert (
        "birth_date" not in people["living-me-script"] and "notes" not in people["living-me-script"]
    )
    assert people["living-me-script"]["private"] is True and "private" not in people["late-grandpa"]
    assert people["late-grandpa"]["birth_place"] == "Pune" and people["old-gran"]["notes"] == "Kept"
    assert all(
        token not in page
        for token in ("__SHARE_JS__", "__LAYOUT_JS__", "__LAYOUT_ENGINE__", "__DATA__", "__TITLE__")
    )
    assert data["partnerships"] == {
        "late-grandpa+old-gran": {"status": "married", "marriage_date": "1970"},
        "late-grandpa+living-me-script": {"status": "married"},
    }

    page, hidden = share_page(
        t,
        Site(name="Website", project="example", url="", hide_living=False),
        [Family(id=t.id, name=t.name)],
    )
    assert hidden == 0 and "Mumbai" in page and '"private"' not in page


@pytest.mark.skipif(not shutil.which("node"), reason="needs Node.js")
@pytest.mark.parametrize("direction", ["DOWN", "RIGHT"])
def test_parent_units_stay_together_with_ancestry_on_both_sides(direction: str) -> None:
    t = Tree(name="Two families")
    for name in (
        "Maternal Grandparent",
        "Mother",
        "Paternal Great Grandparent",
        "Paternal Grandparent",
        "Father",
        "Child",
        "Sibling",
    ):
        seed(t, name)
    for child, parent in (
        ("mother", "maternal-grandparent"),
        ("paternal-grandparent", "paternal-great-grandparent"),
        ("father", "paternal-grandparent"),
        ("child", "mother"),
        ("child", "father"),
        ("sibling", "mother"),
        ("sibling", "father"),
    ):
        t.link(child, "parent", parent)
    t.link("mother", "partner", "father")
    got = run_graph(t, direction)
    geometry = got["geometry"]
    a, b = (geometry["pos"][p] for p in ("mother", "father"))
    card = geometry["card"]
    adjacent = a["x"] == b["x"] and abs(a["y"] - b["y"]) == card["h"]
    assert adjacent, "Partners must form a vertical pair"
    for child in ("child", "sibling"):
        axis, size = ("x", "w") if direction == "RIGHT" else ("y", "h")
        assert geometry["pos"][child][axis] > max(a[axis], b[axis]) + card[size]
    dots = [
        e
        for e in got["edges"]
        if e["className"] == "dot" and set(e["people"]) == {"mother", "father"}
    ]
    assert not dots, "Joined parents share a block without a junction dot"
    paired = [n for n in geometry["nodes"] if n["personId"] in {"mother", "father"}]
    assert {n["joined"] for n in paired} == {"top", "bottom"}
    for node in geometry["nodes"]:
        child = node["personId"]
        if not t.get(child).parents:
            continue
        route = next(
            r
            for r in reversed(geometry["routes"])
            if r["kind"] == "child" and r["children"] == [child]
        )
        top_entry = direction == "DOWN" and node["joined"] != "bottom"
        expected = (
            {"x": node["x"] + card["w"] / 2, "y": node["y"]}
            if top_entry
            else {"x": node["x"], "y": node["y"] + card["h"] / 2}
        )
        assert route["points"][-1] == pytest.approx(expected)
    assert_clean_connections(geometry, got["edges"])


def assert_clean_connections(geometry: dict, edges: list[dict]) -> None:
    """Check what is rendered, including every card and every pair of wire segments."""
    assert_family_paths_connected(geometry, edges)
    lines = [e for e in edges if e.get("points")]
    for e in lines:
        a, b = e["points"]
        assert a["x"] == b["x"] or a["y"] == b["y"], "Diagonal connector"
        for p in geometry["nodes"]:
            if a["x"] == b["x"]:
                hit = (
                    p["x"] + 0.01 < a["x"] < p["x"] + geometry["card"]["w"] - 0.01
                    and max(a["y"], b["y"]) > p["y"] + 0.01
                    and min(a["y"], b["y"]) < p["y"] + geometry["card"]["h"] - 0.01
                )
            else:
                hit = (
                    p["y"] + 0.01 < a["y"] < p["y"] + geometry["card"]["h"] - 0.01
                    and max(a["x"], b["x"]) > p["x"] + 0.01
                    and min(a["x"], b["x"]) < p["x"] + geometry["card"]["w"] - 0.01
                )
            assert not hit, f"Connector {e['net']} passes through a card"
    for i, e in enumerate(lines):
        a, b = e["points"]
        ev = a["x"] == b["x"]
        for f in lines[i + 1 :]:
            c, d = f["points"]
            fv = c["x"] == d["x"]
            if ev == fv:
                axis, fixed = ("y", "x") if ev else ("x", "y")
                overlap = (
                    a[fixed] == c[fixed]
                    and max(min(a[axis], b[axis]), min(c[axis], d[axis]))
                    < min(max(a[axis], b[axis]), max(c[axis], d[axis])) - 0.01
                )
                assert not overlap, "Wire segments overlap instead of sharing one family bus"
            elif e["net"] != f["net"]:
                v, h = (e["points"], f["points"]) if ev else (f["points"], e["points"])
                crossing = (
                    min(h[0]["x"], h[1]["x"]) + 0.01 < v[0]["x"] < max(h[0]["x"], h[1]["x"]) - 0.01
                    and min(v[0]["y"], v[1]["y"]) + 0.01
                    < h[0]["y"]
                    < max(v[0]["y"], v[1]["y"]) - 0.01
                )
                assert not crossing, f"Unrelated connections {e['net']} and {f['net']} cross"


def run_graph(tree: Tree, direction: str = "DOWN") -> dict:
    script = str(files("family_tree_mcp").joinpath("layout.js"))
    result = subprocess.run(
        ["node", "-e", RUNNER, script],
        input=json.dumps({"tree": tree.model_dump(exclude_none=True), "direction": direction}),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


@pytest.mark.skipif(not shutil.which("node"), reason="needs Node.js")
def test_separate_unions_do_not_assign_children_to_a_new_partner(tree: Tree) -> None:
    tree.link("dad", "partner", "ex", divorce_date="1985")
    before = tree.model_dump_json()
    got = run_graph(tree)
    edges = got["edges"]
    assert tree.model_dump_json() == before
    assert any(e["net"] == "dad+ex" and e["className"] == "former" for e in edges)
    # A half-sibling's family branch is distinct from the dad/mom branch.
    for e in edges:
        if e["kind"] != "child":
            continue
        for child in e["children"]:
            assert set(e["parents"]) == set(tree.people[child].parents)
    assert_clean_connections(got["geometry"], edges)


@pytest.mark.skipif(not shutil.which("node"), reason="needs Node.js")
def test_large_graph_has_one_card_per_person_and_every_child_connection() -> None:
    t = Tree(name="Large family")
    seed(t, "Root")
    for i in range(100):
        p = seed(t, f"Child {i}")
        t.link(p.id, "parent", "root")
        kid = seed(t, f"Grandchild {i}")
        t.link(kid.id, "parent", p.id)
    got = run_graph(t)
    assert len(got["geometry"]["nodes"]) == len(t.people)
    assert len({n["personId"] for n in got["geometry"]["nodes"]}) == len(t.people)
    connected = {child for e in got["edges"] if e["kind"] == "child" for child in e["children"]}
    assert connected == set(t.people) - {"root"}
    assert_clean_connections(got["geometry"], got["edges"])


@pytest.mark.skipif(not shutil.which("node"), reason="needs Node.js")
@pytest.mark.parametrize("size", [0, 1])
def test_empty_and_single_person_graphs(size) -> None:
    t = Tree(name="Small tree")
    if size:
        seed(t, "One person")
    got = run_graph(t)
    assert len(got["geometry"]["nodes"]) == size
    assert not got["edges"]


def assert_family_paths_connected(geometry: dict, edges: list[dict]) -> None:
    """Trace the actual drawn segments from each child back to all recorded parents."""
    nets: dict[str, list[dict]] = {}
    for edge in edges:
        if edge.get("points"):
            nets.setdefault(edge["net"], []).append(edge)
    for wires in nets.values():
        children = {c for e in wires if e["kind"] == "child" for c in e["children"]}
        if not children:
            continue
        parents = next(e["parents"] for e in wires if e["kind"] == "child")
        points = {tuple(p.values()) for e in wires for p in e["points"]}
        points = list(points)
        links = list(range(len(points)))

        def root(i, links=links):
            while links[i] != i:
                links[i] = links[links[i]]
                i = links[i]
            return i

        for edge in wires:
            a, b = edge["points"]
            on = [
                i
                for i, (x, y) in enumerate(points)
                if min(a["x"], b["x"]) - 0.001 <= x <= max(a["x"], b["x"]) + 0.001
                and min(a["y"], b["y"]) - 0.001 <= y <= max(a["y"], b["y"]) + 0.001
            ]
            for i in on[1:]:
                links[root(i)] = root(on[0])
        for child in children:
            p = geometry["pos"][child]
            targets = [
                (p["x"], p["y"] + geometry["card"]["h"] / 2),
                (p["x"] + geometry["card"]["w"] / 2, p["y"]),
            ]
            target = next(
                (
                    i
                    for i, (x, y) in enumerate(points)
                    if any(abs(x - tx) < 0.001 and abs(y - ty) < 0.001 for tx, ty in targets)
                ),
                None,
            )
            assert target is not None, f"{child}'s line does not reach its card"
            component = root(target)
            connected = [point for i, point in enumerate(points) if root(i) == component]
            for parent in parents:
                p = geometry["pos"][parent]
                assert any(
                    p["x"] - 0.001 <= x <= p["x"] + geometry["card"]["w"] + 0.001
                    and p["y"] - 0.001 <= y <= p["y"] + geometry["card"]["h"] + 0.001
                    for x, y in connected
                ), f"{child}'s line is disconnected from {parent}"
