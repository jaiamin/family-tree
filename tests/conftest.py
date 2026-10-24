import pytest

from family_tree_mcp.tree import Tree


@pytest.fixture
def tree() -> Tree:
    t = Tree(name="Test")
    for name, sex in [
        ("Grandpa", "male"), ("Grandma", "female"), ("Dad", "male"), ("Mom", "female"),
        ("Aunt", "female"), ("Uncle", "male"), ("Ex", "female"), ("Me", None),
        ("Sis", "female"), ("Half", "male"), ("Cousin", None), ("Cousin Kid", None),
        ("Kid", None), ("Stranger", None),
    ]:  # fmt: skip
        t.add_person(name, sex=sex)
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
