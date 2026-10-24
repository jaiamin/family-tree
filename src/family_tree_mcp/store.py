"""One atomic collection: shared people, tree memberships and website settings."""

import os
import tempfile
import threading
import time
from collections.abc import Callable, Generator
from contextlib import contextmanager
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator

from family_tree_mcp.tree import Partnership, Person, Site, Tree

MAX_BACKUPS = 50


class Family(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    description: str = ""
    members: list[str] = []


class Collection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal[1] = 1
    people: dict[str, Person] = {}
    partnerships: dict[str, Partnership] = {}
    trees: dict[str, Family] = {}
    site: Site | None = None

    @model_validator(mode="after")
    def validate_references(self) -> "Collection":
        for key, family in self.trees.items():
            if str(UUID(key)) != key or key != family.id:
                raise ValueError("Tree keys must match their UUIDs.")
            if (
                len(set(family.members)) != len(family.members)
                or set(family.members) - self.people.keys()
            ):
                raise ValueError(f"Invalid membership in tree '{family.name}'.")
        for key, person in self.people.items():
            if str(UUID(key)) != key or person.id != key:
                raise ValueError("Person keys must match their UUIDs.")
            relatives = person.parents + person.partners
            if key in relatives or set(relatives) - self.people.keys() or len(person.parents) > 2:
                raise ValueError(f"Invalid relationships for '{key}'.")
            if any(key not in self.people[p].partners for p in person.partners):
                raise ValueError(f"Partnerships must be reciprocal for '{key}'.")
        for key in self.partnerships:
            pair = key.split("+")
            if (
                len(pair) != 2
                or pair[0] not in self.people
                or pair[1] not in self.people[pair[0]].partners
            ):
                raise ValueError("Partnership details must reference linked people.")
        return self

    def family(self, reference: str) -> Family:
        if reference in self.trees:
            return self.trees[reference]
        matches = [t for t in self.trees.values() if t.name.casefold() == reference.casefold()]
        if len(matches) != 1:
            raise ValueError(f"No unique tree '{reference}'. Use list_trees for its id.")
        return matches[0]

    def graph(self) -> Tree:
        return Tree(
            name="Collection",
            people={k: p.model_copy(deep=True) for k, p in self.people.items()},
            partnerships={k: p.model_copy(deep=True) for k, p in self.partnerships.items()},
        )

    def project(self, reference: str) -> Tree:
        family = self.family(reference)
        return Tree(
            id=family.id,
            name=family.name,
            description=family.description,
            people={k: self.people[k].model_copy(deep=True) for k in family.members},
            partnerships={k: p.model_copy(deep=True) for k, p in self.partnerships.items()},
        )


class Store:
    def __init__(self, root: Path) -> None:
        self.root = root
        root.mkdir(parents=True, exist_ok=True)
        self._thread_lock = threading.RLock()
        self._locked = False
        self.on_change: Callable[[Collection], None] | None = None

    @contextmanager
    def lock(self) -> Generator[None, None, None]:
        """Serialize collection transactions across threads and processes; re-entrant."""
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

    def collection(self) -> Collection:
        path = self.root / "collection.json"
        if not path.exists():
            if list(self.root.glob("*.json")):
                raise ValueError(
                    "This folder contains old per-tree files. Use a new FAMILY_TREE_DIR "
                    "for the collection model and recreate the trees there. "
                    "The original files have not been changed."
                )
            return Collection()
        return Collection.model_validate_json(path.read_text(encoding="utf-8"))

    def _save(self, data: Collection, backup: bool = True) -> None:
        path = self.root / "collection.json"
        Collection.model_validate(data.model_dump())
        content = data.model_dump_json(indent=2, exclude_none=True)
        old = (
            path.read_text(encoding="utf-8")
            if path.exists()
            else Collection().model_dump_json(indent=2, exclude_none=True)
        )
        if old == content:
            return
        if backup:
            folder = self.root / "backups"
            folder.mkdir(exist_ok=True)
            write_atomic(folder / f"{time.time_ns()}.json", old)
            for stale in self._backups()[:-MAX_BACKUPS]:
                stale.unlink()
        write_atomic(path, content)
        if self.on_change:
            self.on_change(data)

    @contextmanager
    def transaction(self) -> Generator[Collection, None, None]:
        with self.lock():
            data = self.collection()
            yield data
            self._save(data)

    def trees(self) -> list[Tree]:
        data = self.collection()
        return [
            data.project(t.id) for t in sorted(data.trees.values(), key=lambda t: t.name.casefold())
        ]

    def create(self, name: str, description: str = "") -> Tree:
        name = name.strip()
        if not name:
            raise ValueError("Tree name must not be empty.")
        with self.transaction() as data:
            if any(t.name.casefold() == name.casefold() for t in data.trees.values()):
                raise ValueError(f"Tree '{name}' already exists.")
            family = Family(name=name, description=description)
            data.trees[family.id] = family
            return data.project(family.id)

    def load(self, name: str) -> Tree:
        return self.collection().project(name)

    def delete(self, name: str) -> None:
        """Delete only the tree definition. Shared people and links are retained."""
        with self.transaction() as data:
            del data.trees[data.family(name).id]

    def rename(self, name: str, new_name: str) -> Tree:
        new_name = new_name.strip()
        if not new_name:
            raise ValueError("Tree name must not be empty.")
        with self.transaction() as data:
            family = data.family(name)
            if any(
                t.id != family.id and t.name.casefold() == new_name.casefold()
                for t in data.trees.values()
            ):
                raise ValueError(f"Tree '{new_name}' already exists.")
            family.name = new_name
            return data.project(family.id)

    def _backups(self) -> list[Path]:
        return sorted((self.root / "backups").glob("*.json"))

    def undo(self) -> int:
        """Restore the last collection transaction, including all affected trees."""
        with self.lock():
            backups = self._backups()
            if not backups:
                raise ValueError("Nothing to undo.")
            data = Collection.model_validate_json(backups[-1].read_text(encoding="utf-8"))
            self._save(data, backup=False)
            backups[-1].unlink()
            return len(backups) - 1

    def membership(self, tree: str, people: list[str], remove: bool = False) -> Tree:
        with self.transaction() as data:
            family = data.family(tree)
            for pid in people:
                if pid not in data.people:
                    raise ValueError(f"No person with id '{pid}'.")
                if remove:
                    family.members = [i for i in family.members if i != pid]
                elif pid not in family.members:
                    family.members.append(pid)
            return data.project(family.id)

    def merge(self, keep: str, duplicate: str) -> None:
        with self.transaction() as data:
            graph = data.graph()
            graph.merge(keep, duplicate)
            data.people, data.partnerships = graph.people, graph.partnerships
            for family in data.trees.values():
                family.members = list(
                    dict.fromkeys(keep if i == duplicate else i for i in family.members)
                )

    def remove_person(self, pid: str) -> None:
        with self.transaction() as data:
            graph = data.graph()
            graph.get(pid)
            graph.remove_person(pid)
            data.people, data.partnerships = graph.people, graph.partnerships
            for family in data.trees.values():
                family.members = [i for i in family.members if i != pid]

    @contextmanager
    def edit(self, name: str) -> Generator[Tree, None, None]:
        """Edit a projection; preserve links to people outside this tree.

        Reapply relationship differences to the full graph so global cycle and parent limits
        still apply, including paths that travel through other trees.
        """
        with self.transaction() as data:
            before = data.project(name)
            tree = before.model_copy(deep=True)
            yield tree
            if before.people.keys() - tree.people.keys():
                raise ValueError("Use membership, remove_person or merge for removals.")
            graph = data.graph()
            for pid, person in tree.people.items():
                if pid not in before.people:
                    graph.people[pid] = person.model_copy(
                        deep=True, update={"parents": [], "partners": []}
                    )
                    data.family(name).members.append(pid)
                else:
                    for field in (
                        "name",
                        "sex",
                        "birth_date",
                        "death_date",
                        "birth_place",
                        "notes",
                    ):
                        setattr(graph.people[pid], field, getattr(person, field))
            for field, relation in (("parents", "parent"), ("partners", "partner")):
                for pid, person in tree.people.items():
                    old = set(getattr(before.people[pid], field)) if pid in before.people else set()
                    new = set(getattr(person, field))
                    for relative in old - new:
                        graph.unlink(pid, relation, relative)
                for pid, person in tree.people.items():
                    old = set(getattr(before.people[pid], field)) if pid in before.people else set()
                    for relative in getattr(person, field):
                        if relative not in old:
                            graph.link(pid, relation, relative)
            for key in before.partnerships.keys() - tree.partnerships.keys():
                graph.partnerships.pop(key, None)
            graph.partnerships.update(tree.partnerships)
            data.people, data.partnerships = graph.people, graph.partnerships


def write_atomic(path: Path, content: str) -> None:
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def _lock_file(handle, lock: bool) -> None:
    if os.name == "nt":
        import msvcrt

        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK if lock else msvcrt.LK_UNLCK, 1)
    else:
        import fcntl

        fcntl.flock(handle, fcntl.LOCK_EX if lock else fcntl.LOCK_UN)
