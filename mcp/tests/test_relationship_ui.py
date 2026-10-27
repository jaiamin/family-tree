"""The browser's relationship explanation must follow real family edges."""

import json
import subprocess
from pathlib import Path

ASSET = Path(__file__).parents[2] / "web/ui/relationship.js"


def test_relationship_paths(tree):
    pairs = [(a, b) for a in tree.people for b in tree.people]
    script = """
const {compareRelationship} = require(process.argv[1]);
const {tree,pairs} = JSON.parse(require('fs').readFileSync(0,'utf8'));
const before = JSON.stringify(tree);
const results = pairs.map(([a,b]) => compareRelationship(tree,a,b));
if (before !== JSON.stringify(tree)) throw Error('mutated tree');
console.log(JSON.stringify(results));
"""
    results = json.loads(
        subprocess.check_output(
            ["node", "-e", script, str(ASSET)],
            input=json.dumps({"tree": tree.model_dump(mode="json"), "pairs": pairs}),
            text=True,
        )
    )
    for (a, b), result in zip(pairs, results, strict=True):
        path = result["path"]
        if a == "stranger" or b == "stranger":
            assert bool(path) == (a == b)
        if not path:
            continue
        assert path[0] == a and path[-1] == b
        assert len(path) == len(set(path))
        for x, y in zip(path, path[1:], strict=False):
            assert (
                y in tree.people[x].parents
                or x in tree.people[y].parents
                or y in tree.people[x].partners
            )
    by_pair = dict(zip(pairs, results, strict=True))
    for a, b in [
        ("me", "dad"),
        ("me", "sis"),
        ("me", "half"),
        ("me", "cousin"),
        ("me", "cousin-kid"),
        ("kid", "grandpa"),
    ]:
        assert by_pair[a, b]["term"] == tree.relationship(a, b)["relationship"]
    assert by_pair["me", "uncle"]["term"] == "aunt's partner"
