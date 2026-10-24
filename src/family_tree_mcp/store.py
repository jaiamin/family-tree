"""JSON file storage: one human-readable file per tree, with automatic backups for undo."""

import os
import tempfile
import threading
import time
from collections.abc import Callable, Generator
from contextlib import contextmanager
from pathlib import Path

from pydantic import ValidationError

from family_tree_mcp.tree import Tree, slugify

MAX_BACKUPS = 50


class Store:
    def __init__(self, root: Path) -> None:
        self.root = root
        root.mkdir(parents=True, exist_ok=True)
        self._thread_lock = threading.RLock()
        self._locked = False
        self.on_change: Callable[[Tree], None] | None = None  # called after each saved change

    @contextmanager
    def lock(self) -> Generator[None, None, None]:
        """Serialize writes across threads and processes sharing this folder. Re-entrant."""
        with self._thread_lock:
            if self._locked:
                yield
                return
            with open(self.root / ".lock", "a+b") as handle:
                _lock_file(handle, True)
                self._locked = True
                try:
                    yield
                finally:
                    self._locked = False
                    _lock_file(handle, False)

    def _path(self, name: str) -> Path:
        if not (slug := slugify(name)):
            raise ValueError("Tree name must contain letters or digits.")
        return self.root / f"{slug}.json"

    def trees(self) -> list[Tree | str]:
        """Every tree, or the file name of any tree file that can't be read."""
        found: list[Tree | str] = []
        for path in sorted(self.root.glob("*.json")):
            try:
                found.append(Tree.model_validate_json(path.read_text(encoding="utf-8")))
            except (OSError, ValueError):
                found.append(path.name)
        return found

    def create(self, name: str, description: str = "") -> Tree:
        with self.lock():
            if self._path(name).exists():
                raise ValueError(f"Tree '{name}' already exists.")
            tree = Tree(name=name, description=description)
            self.save(tree)
            return tree

    def load(self, name: str) -> Tree:
        path = self._path(name)
        if not path.exists():
            raise ValueError(f"No tree named '{name}'. Use list_trees or create_tree.")
        try:
            return Tree.model_validate_json(path.read_text(encoding="utf-8"))
        except ValidationError as error:
            raise ValueError(
                f"{path.name} is not a valid tree file ({error.error_count()} problems). "
                "Fix it by hand, or use undo to restore the last good version."
            ) from None

    def save(self, tree: Tree, backup: bool = True) -> None:
        with self.lock():
            path = self._path(tree.name)
            content = tree.model_dump_json(indent=2, exclude_none=True)
            if path.exists():
                if path.read_text(encoding="utf-8") == content:
                    return
                if backup:
                    self._backup(tree.name)
            write_atomic(path, content)
        if self.on_change:
            self.on_change(tree)

    def delete(self, name: str) -> None:
        with self.lock():
            self.load(name)
            self._backup(name)
            self._path(name).unlink()

    def rename(self, name: str, new_name: str) -> Tree:
        with self.lock():
            tree = self.load(name)
            old, new = self._path(name), self._path(new_name)
            if new != old and new.exists():
                raise ValueError(f"Tree '{new_name}' already exists.")
            tree.name = new_name
            self.save(tree, backup=False)
            if new != old:
                old.unlink()
                history = self.root / "backups" / old.stem
                if history.exists() and not (target := self.root / "backups" / new.stem).exists():
                    history.rename(target)
            return tree

    def undo(self, name: str) -> tuple[Tree, int]:
        """Restore the most recent backup, returning the tree and how many backups remain."""
        with self.lock():
            backups = self._backups(name)
            if not backups:
                raise ValueError(f"Nothing to undo for '{name}'.")
            tree = Tree.model_validate_json(backups[-1].read_text(encoding="utf-8"))
            if self._path(name).exists():
                current = self.load(name)  # keep the current name and site; undo is for people
                tree.name, tree.site = current.name, current.site
            self.save(tree, backup=False)
            backups[-1].unlink()
            return tree, len(backups) - 1

    def _backups(self, name: str) -> list[Path]:
        return sorted((self.root / "backups" / self._path(name).stem).glob("*.json"))

    def _backup(self, name: str) -> None:
        folder = self.root / "backups" / self._path(name).stem
        folder.mkdir(parents=True, exist_ok=True)
        write_atomic(
            folder / f"{time.time_ns()}.json", self._path(name).read_text(encoding="utf-8")
        )
        for old in self._backups(name)[:-MAX_BACKUPS]:
            old.unlink()

    @contextmanager
    def edit(self, name: str) -> Generator[Tree, None, None]:
        """Load a tree and save it only if the block completes without error."""
        with self.lock():
            tree = self.load(name)
            yield tree
            self.save(tree)


def write_atomic(path: Path, content: str) -> None:
    """Write atomically through a unique temporary file in the same folder."""
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(content)
    os.replace(tmp, path)


def _lock_file(handle, lock: bool) -> None:
    if os.name == "nt":
        import msvcrt

        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK if lock else msvcrt.LK_UNLCK, 1)
    else:
        import fcntl

        fcntl.flock(handle, fcntl.LOCK_EX if lock else fcntl.LOCK_UN)
