import json

import pytest
from family_tree_mcp.store import Collection, Store
from family_tree_mcp.tree import Person, Tree, slugify


def seed(tree: Tree, name: str, **fields) -> Person:
    """Explicit readable fixture IDs for kinship and routing assertions."""
    base = slugify(name) or "person"
    pid, n = base, 1
    while pid in tree.people:
        n += 1
        pid = f"{base}-{n}"
    person = Person(id=pid, name=name, **fields)
    tree.people[pid] = person
    return person


@pytest.fixture
def tree() -> Tree:
    t = Tree(name="Test")
    for name, sex in [
        ("Grandpa", "male"), ("Grandma", "female"), ("Dad", "male"), ("Mom", "female"),
        ("Aunt", "female"), ("Uncle", "male"), ("Ex", "female"), ("Me", None),
        ("Sis", "female"), ("Half", "male"), ("Cousin", None), ("Cousin Kid", None),
        ("Kid", None), ("Stranger", None),
    ]:  # fmt: skip
        seed(t, name, sex=sex)
    for child, parents in {
        "dad": ["grandpa", "grandma"],
        "aunt": ["grandpa", "grandma"],
        "me": ["dad", "mom"],
        "sis": ["dad", "mom"],
        "half": ["dad", "ex"],
        "cousin": ["aunt"],
        "cousin-kid": ["cousin"],
        "kid": ["me"],
    }.items():
        for parent in parents:
            t.link(child, "parent", parent)
    for a, b in [("grandpa", "grandma"), ("dad", "mom"), ("aunt", "uncle")]:
        t.link(a, "partner", b)
    return t


class MemoryStore(Store):
    """API fake for domain tests; production Store always uses the hosted API."""

    def __init__(self, _unused=None):
        super().__init__("http://localhost/family-tree", "test-token")
        self.data = Collection().model_dump(mode="json")
        self.revision = 0

    def request(self, path, body=None, method=None):
        if path != "/collection":
            return {}
        if method == "PUT":
            assert body is not None
            if body["revision"] != self.revision:
                raise ValueError("Someone else updated the family tree.")
            Collection.model_validate(body["collection"])
            self.data = json.loads(json.dumps(body["collection"]))
            self.revision += 1
            return {"revision": self.revision}
        return {"collection": json.loads(json.dumps(self.data)), "revision": self.revision}
