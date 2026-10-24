"""Family tree data model, editing rules, and kinship reasoning."""

import re
from collections import deque
from typing import Any, Literal

from pydantic import BaseModel

Sex = Literal["male", "female"]
Relation = Literal["parent", "child", "partner", "sibling"]
Direction = Literal["ancestors", "descendants"]


class Person(BaseModel, validate_assignment=True):
    id: str
    name: str
    sex: Sex | None = None
    birth_date: str | None = None
    death_date: str | None = None
    birth_place: str | None = None
    notes: str | None = None
    parents: list[str] = []
    partners: list[str] = []


class Tree(BaseModel):
    name: str
    description: str = ""
    people: dict[str, Person] = {}

    def get(self, person_id: str) -> Person:
        if person_id not in self.people:
            raise ValueError(f"No person with id '{person_id}'. Use find_people to look up ids.")
        return self.people[person_id]

    def ref(self, person_id: str) -> dict[str, str]:
        return {"id": person_id, "name": self.people[person_id].name}

    def by_birth(self, ids: list[str]) -> list[str]:
        """Order people by birth date; those without one follow in the order they were added."""
        return sorted(ids, key=lambda i: birth_key(self.people[i].birth_date))

    def children(self, person_id: str) -> list[str]:
        return self.by_birth([p.id for p in self.people.values() if person_id in p.parents])

    def siblings(self, person_id: str) -> list[str]:
        parents = set(self.get(person_id).parents)
        return self.by_birth(
            [p.id for p in self.people.values() if p.id != person_id and parents & set(p.parents)]
        )

    # Editing

    def add_person(self, name: str, **fields: Any) -> Person:
        base = slugify(name) or "person"
        person_id, n = base, 1
        while person_id in self.people:
            n += 1
            person_id = f"{base}-{n}"
        person = Person(id=person_id, name=name, **fields)
        self.people[person_id] = person
        return person

    def update_person(self, person_id: str, **fields: Any) -> Person:
        person = self.get(person_id)
        for key, value in fields.items():
            if value is not None:
                setattr(person, key, value or None)
        return person

    def remove_person(self, person_id: str) -> None:
        self.get(person_id)
        del self.people[person_id]
        for p in self.people.values():
            p.parents = [i for i in p.parents if i != person_id]
            p.partners = [i for i in p.partners if i != person_id]

    def link(self, person_id: str, relation: Relation, relative_id: str) -> None:
        """Record that `relative_id` is `person_id`'s `relation`."""
        person, relative = self.get(person_id), self.get(relative_id)
        if person_id == relative_id:
            raise ValueError("A person cannot be related to themselves.")
        if relation == "partner":
            if relative_id not in person.partners:
                person.partners.append(relative_id)
                relative.partners.append(person_id)
            return
        if relation == "sibling":
            return self._link_siblings(person, relative)
        parent, child = (relative, person) if relation == "parent" else (person, relative)
        if parent.id in child.parents:
            return
        if len(child.parents) >= 2:
            raise ValueError(f"{child.name} already has two parents.")
        if child.id in self.ancestors(parent.id):
            raise ValueError(
                f"{child.name} is an ancestor of {parent.name}; this would be a cycle."
            )
        child.parents.append(parent.id)

    def _link_siblings(self, a: Person, b: Person) -> None:
        """Siblings share parents, so give one the other's parents or a placeholder parent."""
        if set(a.parents) & set(b.parents):
            return
        if a.parents and b.parents:
            raise ValueError(
                f"{a.name} and {b.name} already have different parents. "
                "Link them to a shared parent instead."
            )
        if not a.parents and not b.parents:
            placeholder = self.add_person(
                f"Unknown parent of {a.name}",
                notes="Placeholder linking siblings. Rename or replace when known.",
            )
            a.parents.append(placeholder.id)
        source, target = (a, b) if a.parents else (b, a)
        for parent_id in source.parents:
            self.link(target.id, "parent", parent_id)

    def unlink(self, person_id: str, relation: Relation, relative_id: str) -> None:
        person, relative = self.get(person_id), self.get(relative_id)
        if relation == "sibling":
            raise ValueError("Siblings come from shared parents; remove a parent link instead.")
        if relation == "partner":
            person.partners = [i for i in person.partners if i != relative_id]
            relative.partners = [i for i in relative.partners if i != person_id]
        elif relation == "parent":
            person.parents = [i for i in person.parents if i != relative_id]
        else:
            relative.parents = [i for i in relative.parents if i != person_id]

    # Queries

    def find(self, query: str) -> list[Person]:
        terms = query.lower().split()
        return [p for p in self.people.values() if all(t in p.name.lower() for t in terms)]

    def profile(self, person_id: str) -> dict:
        person = self.get(person_id)
        return {
            **person.model_dump(exclude={"parents", "partners"}, exclude_none=True),
            "parents": [self.ref(i) for i in person.parents],
            "partners": [self.ref(i) for i in person.partners],
            "children": [self.ref(i) for i in self.children(person_id)],
            "siblings": [self.ref(i) for i in self.siblings(person_id)],
        }

    def ancestors(self, person_id: str) -> dict[str, int]:
        """Map each ancestor (and the person, at 0) to their nearest generation distance."""
        return self._walk(person_id, lambda i: self.people[i].parents)

    def descendants(self, person_id: str) -> dict[str, int]:
        return self._walk(person_id, self.children)

    def lineage(self, person_id: str, direction: Direction, generations: int | None) -> list[dict]:
        self.get(person_id)
        found = (
            self.ancestors(person_id) if direction == "ancestors" else self.descendants(person_id)
        )
        by_gen: dict[int, list[dict[str, str]]] = {}
        for i, gen in found.items():
            if gen > 0 and (generations is None or gen <= generations):
                by_gen.setdefault(gen, []).append(self.ref(i))
        return [{"generation": g, "people": by_gen[g]} for g in sorted(by_gen)]

    def relationship(self, person_id: str, relative_id: str) -> dict:
        """Describe how `relative_id` is related to `person_id`."""
        a, b = self.get(person_id), self.get(relative_id)
        result = {"person": self.ref(a.id), "relative": self.ref(b.id)}
        if a.id == b.id:
            return {**result, "relationship": "same person"}
        if blood := self._blood(a.id, b.id):
            term, common = blood
            result |= {"relationship": term, "summary": f"{b.name} is {a.name}'s {term}."}
            if common := [self.ref(i) for i in common if i not in (a.id, b.id)]:
                result["common_ancestors"] = common
            return result
        if b.id in a.partners:
            term = "partner"
        elif via := [t for p in b.partners if (t := self._blood(a.id, p))]:
            term = f"{via[0][0]}'s partner"
        elif via := [t for p in a.partners if (t := self._blood(p, b.id))]:
            term = f"partner's {via[0][0]}"
        else:
            return {**result, "relationship": "no known relationship"}
        return {**result, "relationship": term, "summary": f"{b.name} is {a.name}'s {term}."}

    def _walk(self, start: str, step) -> dict[str, int]:
        self.get(start)
        dist, queue = {start: 0}, deque([start])
        while queue:
            current = queue.popleft()
            for nxt in step(current):
                if nxt not in dist:
                    dist[nxt] = dist[current] + 1
                    queue.append(nxt)
        return dist

    def _blood(self, a: str, b: str) -> tuple[str, list[str]] | None:
        up_a, up_b = self.ancestors(a), self.ancestors(b)
        common = up_a.keys() & up_b.keys()
        if not common:
            return None
        best = min(up_a[i] + up_b[i] for i in common)
        nearest = sorted(i for i in common if up_a[i] + up_b[i] == best)
        da, db = up_a[nearest[0]], up_b[nearest[0]]
        pa, pb = self.people[a].parents, self.people[b].parents
        half = da == db == 1 and len(set(pa) & set(pb)) == 1 and max(len(pa), len(pb)) == 2
        return kinship(da, db, self.people[b].sex, half), nearest


def kinship(da: int, db: int, sex: Sex | None, half: bool = False) -> str:
    """Name B's relation to A from each one's generations (da, db) up to a common ancestor."""

    def word(male: str, female: str, neutral: str) -> str:
        return {"male": male, "female": female}.get(sex or "", neutral)

    if da == 0:
        return _grand(db) + word("son", "daughter", "child")
    if db == 0:
        return _grand(da) + word("father", "mother", "parent")
    if da == db == 1:
        return ("half-" if half else "") + word("brother", "sister", "sibling")
    if da == 1:
        return "great-" * (db - 2) + word("nephew", "niece", "niece/nephew")
    if db == 1:
        return "great-" * (da - 2) + word("uncle", "aunt", "aunt/uncle")
    degree, removed = min(da, db) - 1, abs(da - db)
    term = f"{_ordinal(degree)} cousin"
    if removed:
        term += {1: " once removed", 2: " twice removed"}.get(removed, f" {removed} times removed")
    return term


def _grand(generations: int) -> str:
    return "" if generations == 1 else "great-" * (generations - 2) + "grand"


def _ordinal(n: int) -> str:
    words = {1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth"}
    return words.get(n, f"{n}th")


def birth_key(date: str | None) -> tuple[int, str]:
    """Sort key from the first YYYY, YYYY-MM or YYYY-MM-DD in a free-text date; unknown last."""
    match = re.search(r"\d{4}(?:-\d{2}){0,2}", date or "")
    return (0, match.group()) if match else (1, "")


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
