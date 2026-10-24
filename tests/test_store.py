import pytest

from family_tree_mcp import store as store_module
from family_tree_mcp.store import Store


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
