import pytest
from conftest import seed
from family_tree_mcp.tree import LinkChange, NewPerson, Partnership, PersonChange, Tree, kinship


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
        ("me", "uncle", "uncle by marriage"),
        ("mom", "grandma", "mother-in-law"),
        ("grandma", "mom", "daughter-in-law"),
        ("sis", "mom", "mother"),
        ("half", "mom", "stepmother"),
        ("mom", "half", "stepson"),
        ("mom", "aunt", "sister-in-law"),
        ("cousin", "dad", "uncle"),
        ("uncle", "cousin-kid", "partner's grandchild"),
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


def test_ids_are_unique_uuids_and_survive_renames(tree: Tree) -> None:
    from uuid import UUID

    one, two = tree.add_person("Me"), tree.add_person("Me")
    assert UUID(one.id).version == 4 and UUID(two.id).version == 4
    assert one.id != two.id
    tree.update_person(one.id, name="Different name")
    assert tree.get(one.id).name == "Different name"


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
    seed(tree, "Late Sis", sex="female")
    tree.link("late-sis", "sibling", "me")
    assert tree.get("late-sis").parents == ["dad", "mom"]
    assert tree.relationship("me", "late-sis")["relationship"] == "sister"


def test_sibling_link_without_parents_adds_placeholder(tree: Tree) -> None:
    for name in ("Shashank", "Mukul", "Nina"):
        seed(tree, name)
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
    seed(t, "Parent")
    for name, born in [
        ("Youngest", "2005-01-02"),
        ("Unknown", None),
        ("Eldest", "c. 1999"),
        ("Middle", "2005"),
    ]:
        seed(t, name, birth_date=born)
        t.link(name.lower(), "parent", "parent")
    assert t.children("parent") == ["eldest", "middle", "youngest", "unknown"]
    assert t.siblings("unknown") == ["eldest", "middle", "youngest"]


def test_add_people_links_batch_refs_and_existing_ids(tree: Tree) -> None:
    ids = tree.add_people(
        [
            NewPerson(name="Ravi", sex="male", partners=["cousin"]),
            NewPerson(ref="kid1", name="Asha", siblings=["Dev"]),
            NewPerson(ref="kid2", name="Asha", parents=["Ravi", "cousin"]),
            NewPerson(name="Dev", parents=["Ravi", "cousin"]),
        ]
    )
    assert set(ids) == {"Ravi", "kid1", "kid2", "Dev"}
    assert len(set(ids.values())) == 4
    # Parents are linked before siblings, so Asha shares Dev's parents rather than a placeholder.
    assert tree.get(ids["kid1"]).parents == [ids["Ravi"], "cousin"]
    assert tree.relationship("me", ids["kid1"])["relationship"] == "first cousin once removed"


def test_add_people_rejects_bad_batches(tree: Tree) -> None:
    with pytest.raises(ValueError, match="Unknown person 'Nobody'"):
        tree.add_people([NewPerson(name="Ravi", parents=["Nobody"])])
    with pytest.raises(ValueError, match="appears twice"):
        tree.add_people([NewPerson(name="Ravi"), NewPerson(name="Ravi")])


def test_partner_details_infer_status_and_update(tree: Tree) -> None:
    tree.link("dad", "partner", "mom", marriage_date="1988-06-01", marriage_place="Pune")
    assert tree.partnership("mom", "dad") == Partnership(
        status="married", marriage_date="1988-06-01", marriage_place="Pune"
    )
    tree.link("mom", "partner", "dad", status="divorced", divorce_date="2001")
    assert tree.relationship("mom", "dad")["relationship"] == "ex-husband"
    assert tree.profile("dad")["partners"][0] == {
        "id": "mom", "name": "Mom", "status": "divorced",
        "marriage_date": "1988-06-01", "marriage_place": "Pune", "divorce_date": "2001",
    }  # fmt: skip
    with pytest.raises(ValueError, match="only apply to partner"):
        tree.link("me", "parent", "dad", status="married")
    tree.unlink("dad", "partner", "mom")
    assert tree.partnerships == {}


def test_divorce_makes_step_and_in_law_relations_former(tree: Tree) -> None:
    tree.link("dad", "partner", "ex", status="divorced")
    assert tree.relationship("me", "ex")["relationship"] == "former stepmother"
    assert tree.relationship("ex", "grandma")["relationship"] == "former mother-in-law"
    assert tree.relationship("dad", "ex")["relationship"] == "ex-wife"


def test_profile_marks_half_siblings(tree: Tree) -> None:
    assert tree.profile("me")["siblings"] == [
        {"id": "sis", "name": "Sis"},
        {"id": "half", "name": "Half", "half": True},
    ]


def test_merge_moves_links_and_fills_details(tree: Tree) -> None:
    tree.link("dad", "partner", "mom", status="married")
    seed(tree, "Mother", birth_date="1962", notes="Loves chai")
    tree.link("mother", "partner", "uncle")
    tree.link("cousin", "parent", "mother")
    tree.merge("mom", "mother")

    mom = tree.get("mom")
    assert "mother" not in tree.people
    assert (mom.birth_date, mom.notes, mom.partners) == ("1962", "Loves chai", ["dad", "uncle"])
    assert tree.get("cousin").parents == ["aunt", "mom"]
    assert tree.partnership("mom", "dad") == Partnership(status="married")


def test_merge_replaces_placeholder_parent(tree: Tree) -> None:
    seed(tree, "Shashank")
    seed(tree, "Mukul")
    tree.link("shashank", "sibling", "mukul")
    [placeholder] = tree.get("shashank").parents
    tree.merge("grandpa", placeholder)
    assert tree.relationship("mukul", "dad")["relationship"] == "half-brother"


def test_merge_rejects_impossible_merges(tree: Tree) -> None:
    with pytest.raises(ValueError, match="ancestor and descendant"):
        tree.merge("me", "grandpa")
    with pytest.raises(ValueError, match="3 parents"):
        tree.merge("me", "cousin")


def test_remove_person_drops_partnership_details(tree: Tree) -> None:
    tree.link("dad", "partner", "mom", status="married")
    tree.remove_person("mom")
    assert tree.partnerships == {}


def test_hand_edited_links_are_repaired_on_load() -> None:
    data = {
        "name": "T",
        "people": {
            "a": {"id": "a", "name": "A", "parents": ["ghost", "a", "b"], "partners": ["b", "b"]},
            "b": {"id": "wrong", "name": "B"},
        },
        "partnerships": {"a+b": {"status": "married"}, "a+ghost": {"status": "married"}},
    }
    t = Tree.model_validate(data)
    assert t.people["a"].parents == ["b"] and t.people["a"].partners == ["b"]
    assert t.people["b"].id == "b" and t.people["b"].partners == ["a"]
    assert list(t.partnerships) == ["a+b"]
    assert t.profile("a")["partners"][0]["name"] == "B"


def test_single_line_fields_and_clearing() -> None:
    t = Tree(name="T")
    person = seed(t, "  Ann\nLee ", sex="female", birth_place="Pune\nIndia", notes="a\nb")
    assert (person.name, person.birth_place, person.notes) == ("Ann Lee", "Pune India", "a\nb")
    with pytest.raises(ValueError, match="name can't be empty"):
        t.update_person("ann-lee", name="")
    with pytest.raises(ValueError, match="name can't be empty"):
        seed(t, " \n")
    t.update_person("ann-lee", sex="")
    assert t.people["ann-lee"].sex is None


def test_check_flags_one_parent_children_duplicates_and_placeholders(tree: Tree) -> None:
    # Cousin lists only Aunt, whose partner is Uncle. Kid lists only Me, who has no partner.
    seed(tree, "Dad")
    tree.link("stranger", "sibling", "kid")  # Stranger shares Kid's parent: no placeholder.
    seed(tree, "Lone")
    tree.link("lone", "sibling", "half")  # Half already has parents, so Lone copies them.
    seed(tree, "Solo")
    seed(tree, "Solo Sib")
    tree.link("solo", "sibling", "solo-sib")
    issues = tree.check()
    assert [i["summary"] for i in issues] == [
        "Cousin lists only Aunt as a parent. If Uncle is the other parent, link them.",
        "'Unknown parent of Solo' is a placeholder. Rename it when known, "
        "or merge it with the real person.",
        "2 people are named Dad (dad, dad-2). If they are the same person, merge them.",
    ]
    # Edits only hear about couples they touch.
    assert len(tree.check({"uncle"})) == 1 and tree.check({"kid", "me"}) == []
    tree.link("cousin", "parent", "uncle")
    assert tree.check({"uncle"}) == []


def test_check_lists_every_child_and_partner(tree: Tree) -> None:
    for name in ("Nisha", "Hetal", "Nishi"):
        seed(tree, name)
        tree.link(name.lower(), "parent", "stranger")
    seed(tree, "Hemalata")
    seed(tree, "Rina")
    tree.link("stranger", "partner", "hemalata")
    tree.link("stranger", "partner", "rina")
    assert tree.check({"hemalata"})[0]["summary"] == (
        "Nisha, Hetal and Nishi list only Stranger as a parent. "
        "If Hemalata or Rina is the other parent, link them."
    )


def test_apply_changes_details_then_links(tree: Tree) -> None:
    tree.apply(
        [PersonChange(id="kid", name="Kiddo", birth_date="2001"), PersonChange(id="ex", notes="")],
        [
            LinkChange(person_id="kid", relation="parent", relative_id="stranger"),
            LinkChange(person_id="aunt", relation="partner", relative_id="uncle", remove=True),
            LinkChange(person_id="me", relation="partner", relative_id="ex", status="married"),
        ],
    )
    assert tree.people["kid"].name == "Kiddo" and tree.people["kid"].parents == ["me", "stranger"]
    assert tree.people["aunt"].partners == []
    assert tree.partnership("me", "ex") == Partnership(status="married")
