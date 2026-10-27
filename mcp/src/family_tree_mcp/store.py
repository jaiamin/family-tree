"""Collection operations backed by the website API, with optimistic concurrency."""

import json
import threading
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path
from typing import Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator

from family_tree_mcp.tree import Partnership, Person, Site, Tree


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
    def __init__(self, url: str, token: str) -> None:
        parsed = urlparse(url)
        if parsed.scheme != "https" and not (
            parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}
        ):
            raise ValueError("FAMILY_TREE_URL must use HTTPS (HTTP is allowed for localhost).")
        if parsed.username or parsed.password or parsed.query or parsed.fragment or not token:
            raise ValueError("Set FAMILY_TREE_URL and FAMILY_TREE_TOKEN separately.")
        self.url = url.rstrip("/")
        self._token = token
        self._thread_lock = threading.RLock()
        self._active: Collection | None = None

    def request(self, path: str, body: dict | None = None, method: str | None = None):
        request = Request(
            f"{self.url}/api{path}",
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Content-Type": "application/json"},
            method=method or ("POST" if body is not None else "GET"),
        )
        # urllib otherwise forwards ordinary headers to redirected origins.
        request.add_unredirected_header("Authorization", f"Bearer {self._token}")
        try:
            with urlopen(request, timeout=30) as response:
                return json.load(response)
        except HTTPError as error:
            try:
                message = json.loads(error.read(8192)).get("error", "Website request failed.")
            except (ValueError, AttributeError):
                message = "Website request failed."
            raise ValueError(message) from None
        except (URLError, TimeoutError):
            raise ValueError(
                "Couldn't reach the family website. No local changes were saved."
            ) from None

    @contextmanager
    def lock(self) -> Generator[None, None, None]:
        with self._thread_lock:
            yield

    def collection(self) -> Collection:
        with self.lock():
            if self._active is not None:
                return self._active.model_copy(deep=True)
            return Collection.model_validate(self.request("/collection")["collection"])

    @contextmanager
    def transaction(self) -> Generator[Collection, None, None]:
        with self.lock():
            if self._active is not None:
                raise ValueError("Nested collection writes are not supported.")
            snapshot = self.request("/collection")
            data = Collection.model_validate(snapshot["collection"])
            original = data.model_dump(mode="json")
            self._active = data
            try:
                yield data
                Collection.model_validate(data.model_dump())
                updated = data.model_dump(mode="json")
                if updated != original:
                    self.request(
                        "/collection",
                        {"collection": updated, "revision": snapshot["revision"]},
                        "PUT",
                    )
            finally:
                self._active = None

    def import_collection(self, path: str) -> dict:
        """One explicit import into an empty website; UUIDs are preserved."""
        imported = Collection.model_validate_json(Path(path).expanduser().read_text())
        with self.transaction() as data:
            if data.people or data.trees:
                raise ValueError("Import is only allowed into an empty website.")
            data.people = imported.people
            data.partnerships = imported.partnerships
            data.trees = imported.trees
            data.site = imported.site
        return {"people": len(imported.people), "trees": len(imported.trees)}

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
