"""JSON file storage: one human-readable file per tree, with automatic backups for undo."""

import time
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path

from family_tree_mcp.tree import Tree, slugify

MAX_BACKUPS = 50


class Store:
    def __init__(self, root: Path) -> None:
        self.root = root
        root.mkdir(parents=True, exist_ok=True)

    def _path(self, name: str) -> Path:
        if not (slug := slugify(name)):
            raise ValueError("Tree name must contain letters or digits.")
        return self.root / f"{slug}.json"

    def trees(self) -> list[Tree]:
        return [Tree.model_validate_json(p.read_text()) for p in sorted(self.root.glob("*.json"))]

    def create(self, name: str, description: str = "") -> Tree:
        if self._path(name).exists():
            raise ValueError(f"Tree '{name}' already exists.")
        tree = Tree(name=name, description=description)
        self.save(tree)
        return tree

    def load(self, name: str) -> Tree:
        path = self._path(name)
        if not path.exists():
            raise ValueError(f"No tree named '{name}'. Use list_trees or create_tree.")
        return Tree.model_validate_json(path.read_text())

    def save(self, tree: Tree, backup: bool = True) -> None:
        path = self._path(tree.name)
        content = tree.model_dump_json(indent=2, exclude_none=True)
        if path.exists():
            if path.read_text() == content:
                return
            if backup:
                self._backup(tree.name)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(content)
        tmp.replace(path)

    def delete(self, name: str) -> None:
        self.load(name)
        self._backup(name)
        self._path(name).unlink()

    def undo(self, name: str) -> tuple[Tree, int]:
        """Restore the most recent backup, returning the tree and how many backups remain."""
        backups = self._backups(name)
        if not backups:
            raise ValueError(f"Nothing to undo for '{name}'.")
        tree = Tree.model_validate_json(backups[-1].read_text())
        self.save(tree, backup=False)
        backups[-1].unlink()
        return tree, len(backups) - 1

    def _backups(self, name: str) -> list[Path]:
        return sorted((self.root / "backups" / self._path(name).stem).glob("*.json"))

    def _backup(self, name: str) -> None:
        folder = self.root / "backups" / self._path(name).stem
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{time.time_ns()}.json").write_text(self._path(name).read_text())
        for old in self._backups(name)[:-MAX_BACKUPS]:
            old.unlink()

    @contextmanager
    def edit(self, name: str) -> Generator[Tree, None, None]:
        """Load a tree and save it only if the block completes without error."""
        tree = self.load(name)
        yield tree
        self.save(tree)
