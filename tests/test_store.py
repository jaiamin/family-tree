import threading

import pytest

from family_tree_mcp import store as store_module
from family_tree_mcp.store import Store
from family_tree_mcp.tree import Site, Tree


def names(store: Store) -> list[str]:
    return [p.name for p in store.load("T").people.values()]


def add(store: Store, name: str) -> None:
    with store.edit("T") as tree:
        tree.add_person(name)


def test_undo_steps_back_through_changes(tmp_path) -> None:
    store = Store(tmp_path)
    store.create("T")
    add(store, "Ann")
    add(store, "Bo")

    assert store.undo("T")[1] == 1
    assert names(store) == ["Ann"]
    store.undo("T")
    assert names(store) == []
    with pytest.raises(ValueError, match="Nothing to undo"):
        store.undo("T")


def test_unchanged_saves_are_not_backed_up(tmp_path) -> None:
    store = Store(tmp_path)
    store.create("T")
    add(store, "Ann")
    with store.edit("T"):
        pass
    store.undo("T")
    assert names(store) == []


def test_deleted_tree_can_be_restored(tmp_path) -> None:
    store = Store(tmp_path)
    store.create("T")
    add(store, "Ann")
    store.delete("T")
    assert store.trees() == []

    tree, _ = store.undo("T")
    assert tree.name == "T" and names(store) == ["Ann"]


def test_old_backups_are_pruned(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(store_module, "MAX_BACKUPS", 2)
    store = Store(tmp_path)
    store.create("T")
    for name in ("A", "B", "C", "D"):
        add(store, name)

    store.undo("T")
    store.undo("T")
    assert names(store) == ["A", "B"]
    with pytest.raises(ValueError, match="Nothing to undo"):
        store.undo("T")


def test_rename_moves_tree_and_history(tmp_path) -> None:
    store = Store(tmp_path)
    store.create("T")
    add(store, "Ann")
    store.create("Taken")
    with pytest.raises(ValueError, match="already exists"):
        store.rename("T", "Taken")

    with store.edit("T") as tree:
        tree.site = Site(project="t", url="https://t.pages.dev")
    store.rename("T", "Amin-Patel Family")
    assert [t.name for t in store.trees() if isinstance(t, Tree)] == ["Amin-Patel Family", "Taken"]
    store.undo("amin-patel-family")
    assert store.load("Amin-Patel Family").name == "Amin-Patel Family"
    store.undo("amin-patel-family")
    assert store.load("Amin-Patel Family").people == {}
    assert store.load("Amin-Patel Family").site == Site(project="t", url="https://t.pages.dev")


def test_concurrent_edits_are_not_lost(tmp_path) -> None:
    Store(tmp_path).create("T")
    # Two stores on one folder stand in for two apps sharing the trees.
    stores = [Store(tmp_path), Store(tmp_path)]
    workers = [threading.Thread(target=add, args=(stores[i % 2], f"P{i}")) for i in range(20)]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join()
    assert len(names(stores[0])) == 20
    assert not list(tmp_path.glob("*.tmp"))


def test_unreadable_tree_files_are_reported_not_fatal(tmp_path) -> None:
    store = Store(tmp_path)
    store.create("Good")
    (tmp_path / "broken.json").write_text("{not json")
    assert [t if isinstance(t, str) else t.name for t in store.trees()] == ["broken.json", "Good"]
    (tmp_path / "bad.json").write_text('{"people": {}}')
    with pytest.raises(ValueError, match="not a valid tree file"):
        store.load("Bad")
