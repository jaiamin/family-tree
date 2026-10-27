from uuid import UUID

import pytest
from conftest import MemoryStore as Store


def add(store: Store, name: str, tree: str = "T") -> str:
    with store.edit(tree) as graph:
        return graph.add_person(name).id


def test_failed_edit_is_not_saved(tmp_path) -> None:
    store = Store(tmp_path)
    store.create("T")
    with pytest.raises(ValueError), store.edit("T") as tree:
        ann = tree.add_person("Ann")
        tree.link(ann.id, "parent", "ghost")
    assert store.collection().people == {}


def test_shared_identity_updates_and_membership_removal_preserve_links(tmp_path) -> None:
    store = Store(tmp_path)
    first, second = store.create("T"), store.create("Other")
    parent, child = add(store, "Parent"), add(store, "Child")
    assert UUID(first.id).version == UUID(parent).version == 4
    with store.edit(first.id) as tree:
        tree.link(child, "parent", parent)
    store.membership(second.id, [parent])
    # The projection hides absent relatives, but editing it must retain global links.
    assert store.load(second.id).children(parent) == []
    with store.edit(second.id) as tree:
        tree.update_person(parent, name="Renamed parent")
    assert store.load(first.id).get(parent).name == "Renamed parent"
    assert store.collection().people[child].parents == [parent]
    store.membership(second.id, [child])
    assert store.load(second.id).get(child).parents == [parent]
    store.membership(first.id, [parent], remove=True)
    assert parent not in store.load(first.id).people
    assert store.load(second.id).get(child).parents == [parent]
    assert len(store.collection().people) == 2


def test_links_outside_projection_survive_edits_and_global_cycles_are_rejected(tmp_path) -> None:
    store = Store(tmp_path)
    store.create("T")
    a, b, c = [add(store, name) for name in ("A", "B", "C")]
    with store.edit("T") as tree:
        tree.link(b, "parent", a)
        tree.link(c, "parent", b)
    store.create("Partial")
    store.membership("Partial", [a, c])
    with pytest.raises(ValueError), store.edit("Partial") as tree:
        tree.link(a, "parent", c)
    assert store.collection().people[a].parents == []
    with store.edit("Partial") as tree:
        tree.update_person(c, notes="Updated")
    assert store.collection().people[c].parents == [b]


def test_parent_limit_includes_hidden_parents(tmp_path) -> None:
    store = Store(tmp_path)
    store.create("T")
    a, b, c, kid = [add(store, name) for name in ("A", "B", "C", "Child")]
    with store.edit("T") as tree:
        tree.link(kid, "parent", a)
        tree.link(kid, "parent", b)
    store.create("Partial")
    store.membership("Partial", [c, kid])
    with pytest.raises(ValueError), store.edit("Partial") as tree:
        tree.link(kid, "parent", c)
    assert store.collection().people[kid].parents == [a, b]


def test_merge_and_delete_apply_across_memberships(tmp_path) -> None:
    store = Store(tmp_path)
    store.create("T")
    keep, duplicate, child = [add(store, name) for name in ("Parent", "Duplicate", "Child")]
    with store.edit("T") as tree:
        tree.link(child, "parent", duplicate)
    store.create("Other")
    store.membership("Other", [duplicate, child])
    store.merge(keep, duplicate)
    assert set(store.load("Other").people) == {keep, child}
    assert store.load("Other").get(child).parents == [keep]
    assert duplicate not in store.collection().people
    store.remove_person(keep)
    assert store.load("Other").get(child).parents == []


def test_batch_reversal_removes_old_links_before_adding_new_ones(tmp_path) -> None:
    store = Store(tmp_path)
    store.create("T")
    first, second = add(store, "First"), add(store, "Second")
    with store.edit("T") as tree:
        tree.link(second, "parent", first)
    with store.edit("T") as tree:
        tree.unlink(second, "parent", first)
        tree.link(first, "parent", second)
    assert store.collection().people[first].parents == [second]
    assert store.collection().people[second].parents == []
