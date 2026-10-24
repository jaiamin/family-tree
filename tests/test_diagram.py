import re

from conftest import seed

from family_tree_mcp.diagram import mermaid
from family_tree_mcp.tree import Tree


def family() -> Tree:
    t = Tree(name='The "Smith" Family')
    seed(t, "Gran", sex="female", birth_date="1930-05-01", death_date="2001")
    seed(t, "Grandpa", sex="male")
    seed(t, "Mum", sex="female", birth_date="1960")
    seed(t, "Dad", sex="male")
    seed(t, "Kid")
    seed(t, "Uncle", sex="male")
    seed(t, "Spouse")
    seed(t, "Stranger")
    t.link("gran", "partner", "grandpa")
    t.link("mum", "partner", "dad")
    t.link("uncle", "partner", "spouse")
    for child, parents in {
        "mum": ["gran", "grandpa"],
        "uncle": ["gran"],
        "kid": ["mum", "dad"],
    }.items():
        for parent in parents:
            t.link(child, "parent", parent)
    return t


def nodes(src: str) -> dict[str, str]:
    """Map person names to their Mermaid node ids."""
    return {name: node for node, name in re.findall(r'(p\d+)\["([^"<]+)', src)}


def test_couple_children_hang_from_shared_union_node() -> None:
    src = mermaid(family())
    n = nodes(src)
    [union] = re.findall(rf"(u\d+) --> {n['Mum']}\n", src)
    assert f"{n['Gran']} --- {union}" in src and f"{n['Grandpa']} --- {union}" in src
    assert f"{n['Gran']} --> {n['Uncle']}" in src  # single known parent links directly


def test_labels_styles_and_escaping() -> None:
    src = mermaid(family(), "kid")
    n = nodes(src)
    assert 'title: "The \\"Smith\\" Family"' in src
    assert "Gran<br/><small>1930–2001</small>" in src
    assert "Mum<br/><small>b. 1960</small>" in src
    assert f"class {n['Gran']} deceased" in src
    assert f"class {n['Kid']} focus" in src


def test_views_scope_the_diagram() -> None:
    t = family()
    assert set(nodes(mermaid(t, "kid", "ancestors"))) == {"Gran", "Grandpa", "Mum", "Dad", "Kid"}
    assert set(nodes(mermaid(t, "kid", "ancestors", generations=1))) == {"Mum", "Dad", "Kid"}
    # Descendants include their partners, so couples stay together.
    assert set(nodes(mermaid(t, "gran", "descendants", generations=1))) == {
        "Gran", "Grandpa", "Mum", "Dad", "Uncle", "Spouse"
    }  # fmt: skip
    assert "Stranger" in nodes(mermaid(t))


def test_divorced_couples_use_dotted_links() -> None:
    t = family()
    t.link("mum", "partner", "dad", status="divorced")
    src = mermaid(t)
    n = nodes(src)
    assert re.search(rf"{n['Mum']} -\.- u\d+", src) and re.search(rf"{n['Dad']} -\.- u\d+", src)
    assert re.search(rf"{n['Gran']} --- u\d+", src)
