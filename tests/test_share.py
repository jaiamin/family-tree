import json
import shutil
import subprocess
from importlib.resources import files

import pytest

from family_tree_mcp.diagram import View, mermaid
from family_tree_mcp.share import share_page
from family_tree_mcp.tree import Tree

RUNNER = """
const lib = require(process.argv[1]);
const { tree, pairs, views } = JSON.parse(require("fs").readFileSync(0, "utf8"));
console.log(JSON.stringify({
  relationships: pairs.map(([a, b]) => lib.relationship(tree, a, b)),
  diagrams: views.map(([focus, view, gens]) => lib.toMermaid(tree, focus, view, gens).source),
}));
"""


@pytest.mark.skipif(not shutil.which("node"), reason="needs Node.js")
def test_browser_logic_matches_python(tree: Tree) -> None:
    tree.update_person(
        "grandma", birth_date="1931-02-03", death_date="2001", name='Grandma "Nana" Núñez'
    )
    tree.update_person("sis", birth_date="1990")
    tree.update_person("me", birth_date="c. 1995")
    tree.link("sis", "partner", "stranger")
    tree.link("dad", "partner", "mom", status="married", marriage_date="1988")
    tree.link("dad", "partner", "ex", divorce_date="1985")
    ids = list(tree.people)
    pairs = [(a, b) for a in ids for b in ids]
    views: list[tuple[str | None, View, int | None]] = [(None, "both", None)] + [
        (pid, view, gens)
        for pid in ids
        for view in ("ancestors", "descendants", "both")
        for gens in (None, 1)
    ]
    data = {"tree": tree.model_dump(exclude_none=True), "pairs": pairs, "views": views}
    script = str(files("family_tree_mcp").joinpath("share.js"))
    result = subprocess.run(
        ["node", "-e", RUNNER, script],
        input=json.dumps(data),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    js = json.loads(result.stdout)

    for (a, b), got in zip(pairs, js["relationships"], strict=True):
        expected = tree.relationship(a, b)
        assert got == {k: expected[k] for k in ("relationship", "summary") if k in expected}
    for (focus, view, gens), got in zip(views, js["diagrams"], strict=True):
        assert got == mermaid(tree, focus, view, gens)


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
    assert people["late-grandpa"]["birth_place"] == "Pune" and people["old-gran"]["notes"] == "Kept"
    assert "__" not in page.replace("__proto__", "")
    assert data["partnerships"] == {
        "late-grandpa+old-gran": {"status": "married", "marriage_date": "1970"},
        "late-grandpa+living-me-script": {"status": "married"},
    }

    page, hidden = share_page(t, hide_living=False)
    assert hidden == 0 and "Mumbai" in page
