"""JSON file storage: one human-readable file per tree."""

from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path

from family_tree_mcp.tree import Tree, slugify


class Store:
    def __init__(self, root: Path) -> None:
        self.root = root
        root.mkdir(parents=True, exist_ok=True)

    def _path(self, name: str) -> Path:
        if not (slug := slugify(name)):
            raise ValueError("Tree name must contain letters or digits.")
        return self.root / f"{slug}.json"

    def list(self) -> list[Tree]:
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

    def save(self, tree: Tree) -> None:
        path = self._path(tree.name)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(tree.model_dump_json(indent=2, exclude_none=True))
        tmp.replace(path)

    def delete(self, name: str) -> None:
        self.load(name)
        self._path(name).unlink()

    @contextmanager
    def edit(self, name: str) -> Generator[Tree, None, None]:
        """Load a tree and save it only if the block completes without error."""
        tree = self.load(name)
        yield tree
        self.save(tree)
