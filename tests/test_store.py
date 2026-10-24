import threading
from uuid import UUID

import pytest

from family_tree_mcp import store as store_module
from family_tree_mcp.store import Store
from family_tree_mcp.tree import Site


def add(store: Store, name: str, tree: str = "T") -> str:
    with store.edit(tree) as graph:
        return graph.add_person(name).id


def test_collection_undo_restores_whole_transactions(tmp_path) -> None:
    store = Store(tmp_path)
    store.create("T")
    add(store, "Ann")
    add(store, "Bo")
    assert store.undo() == 2
    assert [p.name for p in store.load("T").people.values()] == ["Ann"]
    store.undo()
    assert store.load("T").people == {}
    store.undo()
    assert store.trees() == []
    with pytest.raises(ValueError, match="Nothing to undo"):
        store.undo()


def test_unchanged_saves_are_not_backed_up(tmp_path) -> None:
    store = Store(tmp_path)
    store.create("T")
    add(store, "Ann")
    with store.edit("T"):
        pass
    store.undo()
    assert store.load("T").people == {}


def test_tree_deletion_keeps_shared_people_and_undo_restores_membership(tmp_path) -> None:
    store = Store(tmp_path)
    tree = store.create("T")
    pid = add(store, "Ann")
    store.delete(tree.id)
    assert store.trees() == [] and pid in store.collection().people
    store.undo()
    assert list(store.load(tree.id).people) == [pid]


def test_old_backups_are_pruned(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(store_module, "MAX_BACKUPS", 2)
    store = Store(tmp_path)
    store.create("T")
    for name in ("A", "B", "C", "D"):
        add(store, name)
    store.undo()
    store.undo()
    assert len(store.load("T").people) == 2
    with pytest.raises(ValueError, match="Nothing to undo"):
        store.undo()


def test_rename_keeps_tree_identity_and_site_is_independent(tmp_path) -> None:
    store = Store(tmp_path)
    tree = store.create("T")
    store.create("Taken")
    with store.transaction() as data:
        data.site = Site(name="Website", project="example", url="")
    with pytest.raises(ValueError, match="already exists"):
        store.rename(tree.id, "Taken")
    store.rename(tree.id, "Renamed")
    assert store.load(tree.id).name == "Renamed"
    site = store.collection().site
    assert site is not None and site.name == "Website"
    store.undo()
    assert store.load(tree.id).name == "T"


def test_concurrent_edits_are_not_lost(tmp_path) -> None:
    Store(tmp_path).create("T")
    stores = [Store(tmp_path), Store(tmp_path)]
    workers = [threading.Thread(target=add, args=(stores[i % 2], f"P{i}")) for i in range(20)]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join()
    assert len(stores[0].load("T").people) == 20
    assert not list(tmp_path.glob("*.tmp"))


def test_old_files_are_never_used_or_changed(tmp_path) -> None:
    original = '{"name":"Old","people":{}}'
    (tmp_path / "old.json").write_text(original)
    with pytest.raises(ValueError, match="new FAMILY_TREE_DIR"):
        Store(tmp_path).create("T")
    assert (tmp_path / "old.json").read_text() == original
    assert not (tmp_path / "collection.json").exists()


def test_corrupt_collection_is_not_overwritten(tmp_path) -> None:
    (tmp_path / "collection.json").write_text("{not json")
    with pytest.raises(ValueError):
        Store(tmp_path).create("T")
    assert (tmp_path / "collection.json").read_text() == "{not json"


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
    store.undo()
    assert parent in store.load(first.id).people


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


def test_merge_and_delete_apply_across_memberships_and_undo(tmp_path) -> None:
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
    store.undo()
    assert store.load("Other").get(child).parents == [keep]
    store.undo()
    assert store.load("Other").get(child).parents == [duplicate]


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
