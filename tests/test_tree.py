import pytest

from family_tree_mcp.tree import Tree, kinship


@pytest.mark.parametrize(
    ("person", "relative", "expected"),
    [
        ("me", "grandpa", "grandfather"),
        ("grandma", "kid", "great-grandchild"),
        ("me", "sis", "sister"),
        ("me", "half", "half-brother"),
        ("me", "aunt", "aunt"),
        ("aunt", "me", "niece/nephew"),
        ("me", "cousin", "first cousin"),
        ("me", "cousin-kid", "first cousin once removed"),
        ("kid", "cousin-kid", "second cousin"),
        ("dad", "mom", "partner"),
        ("me", "uncle", "aunt's partner"),
        ("mom", "grandma", "partner's mother"),
        ("me", "me", "same person"),
        ("me", "stranger", "no known relationship"),
    ],
)
def test_relationship(tree: Tree, person: str, relative: str, expected: str) -> None:
    assert tree.relationship(person, relative)["relationship"] == expected


def test_relationship_names_common_ancestors(tree: Tree) -> None:
    result = tree.relationship("me", "cousin")
    assert result["summary"] == "Cousin is Me's first cousin."
    assert {p["id"] for p in result["common_ancestors"]} == {"grandpa", "grandma"}
    assert "common_ancestors" not in tree.relationship("me", "grandpa")


@pytest.mark.parametrize(
    ("da", "db", "sex", "expected"),
    [
        (0, 4, "female", "great-great-granddaughter"),
        (4, 1, "male", "great-great-uncle"),
        (1, 3, None, "great-niece/nephew"),
        (3, 3, None, "second cousin"),
        (2, 5, None, "first cousin 3 times removed"),
        (7, 7, None, "6th cousin"),
    ],
)
def test_kinship_terms(da: int, db: int, sex, expected: str) -> None:
    assert kinship(da, db, sex) == expected


def test_profile_derives_children_and_siblings(tree: Tree) -> None:
    profile = tree.profile("me")
    assert [p["id"] for p in profile["parents"]] == ["dad", "mom"]
    assert [p["id"] for p in profile["children"]] == ["kid"]
    assert {p["id"] for p in profile["siblings"]} == {"sis", "half"}


def test_lineage_groups_by_generation(tree: Tree) -> None:
    assert tree.lineage("kid", "ancestors", 2) == [
        {"generation": 1, "people": [{"id": "me", "name": "Me"}]},
        {"generation": 2, "people": [{"id": "dad", "name": "Dad"}, {"id": "mom", "name": "Mom"}]},
    ]
    gens = tree.lineage("grandpa", "descendants", None)
    assert [g["generation"] for g in gens] == [1, 2, 3]


def test_link_rejects_invalid_relationships(tree: Tree) -> None:
    with pytest.raises(ValueError, match="cycle"):
        tree.link("grandpa", "parent", "kid")
    with pytest.raises(ValueError, match="two parents"):
        tree.link("me", "parent", "aunt")
    with pytest.raises(ValueError, match="themselves"):
        tree.link("me", "partner", "me")
    with pytest.raises(ValueError, match="No person"):
        tree.link("me", "child", "nobody")


def test_child_relation_is_inverse_of_parent(tree: Tree) -> None:
    tree.link("stranger", "child", "cousin")
    assert tree.get("cousin").parents == ["aunt", "stranger"]
    tree.unlink("stranger", "child", "cousin")
    assert tree.get("cousin").parents == ["aunt"]


def test_unlink_partner_is_symmetric(tree: Tree) -> None:
    tree.unlink("mom", "partner", "dad")
    assert tree.get("dad").partners == [] and tree.get("mom").partners == []


def test_remove_person_clears_references(tree: Tree) -> None:
    tree.remove_person("dad")
    assert tree.get("me").parents == ["mom"]
    assert tree.get("mom").partners == []


def test_ids_are_unique_slugs(tree: Tree) -> None:
    assert tree.add_person("Me").id == "me-2"


def test_update_person(tree: Tree) -> None:
    tree.update_person("me", birth_place="Paris")
    tree.update_person("me", birth_place="", notes="hi")
    me = tree.get("me")
    assert me.birth_place is None and me.notes == "hi"
    with pytest.raises(ValueError):
        tree.update_person("me", sex="robot")


def test_find_matches_all_words_case_insensitively(tree: Tree) -> None:
    assert [p.id for p in tree.find("kid COUSIN")] == ["cousin-kid"]


def test_sibling_link_shares_known_parents(tree: Tree) -> None:
    tree.add_person("Late Sis", sex="female")
    tree.link("late-sis", "sibling", "me")
    assert tree.get("late-sis").parents == ["dad", "mom"]
    assert tree.relationship("me", "late-sis")["relationship"] == "sister"


def test_sibling_link_without_parents_adds_placeholder(tree: Tree) -> None:
    for name in ("Shashank", "Mukul", "Nina"):
        tree.add_person(name)
    tree.link("shashank", "sibling", "mukul")
    tree.link("nina", "sibling", "shashank")
    [placeholder] = tree.get("shashank").parents
    assert tree.get(placeholder).name == "Unknown parent of Shashank"
    assert tree.get("mukul").parents == tree.get("nina").parents == [placeholder]


def test_sibling_link_rejects_people_with_different_parents(tree: Tree) -> None:
    with pytest.raises(ValueError, match="different parents"):
        tree.link("me", "sibling", "cousin")
    with pytest.raises(ValueError, match="parent link"):
        tree.unlink("me", "sibling", "sis")


def test_children_and_siblings_are_ordered_by_birth() -> None:
    t = Tree(name="T")
    t.add_person("Parent")
    for name, born in [
        ("Youngest", "2005-01-02"),
        ("Unknown", None),
        ("Eldest", "c. 1999"),
        ("Middle", "2005"),
    ]:
        t.add_person(name, birth_date=born)
        t.link(name.lower(), "parent", "parent")
    assert t.children("parent") == ["eldest", "middle", "youngest", "unknown"]
    assert t.siblings("unknown") == ["eldest", "middle", "youngest"]
