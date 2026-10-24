"""Family tree data model, editing rules, and kinship reasoning."""

import re
from collections import deque
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, Field, model_validator

Sex = Literal["male", "female"]
Relation = Literal["parent", "child", "partner", "sibling"]
Direction = Literal["ancestors", "descendants"]
PartnerStatus = Literal["married", "divorced", "partners"]
DETAILS = ("sex", "birth_date", "death_date", "birth_place", "notes")


def _one_line(text: str) -> str:
    return " ".join(text.split())


def _name(text: str) -> str:
    if not (text := _one_line(text)):
        raise ValueError("A person's name can't be empty.")
    return text


# Names, dates and places are single-line in diagrams and GEDCOM; notes may span lines.
Line = Annotated[str, AfterValidator(_one_line)]
Name = Annotated[str, AfterValidator(_name)]


class Person(BaseModel, validate_assignment=True):
    id: str
    name: Name
    sex: Sex | None = None
    birth_date: Line | None = None
    death_date: Line | None = None
    birth_place: Line | None = None
    notes: str | None = None
    parents: list[str] = []
    partners: list[str] = []


class Partnership(BaseModel, validate_assignment=True):
    status: PartnerStatus | None = None
    marriage_date: Line | None = None
    marriage_place: Line | None = None
    divorce_date: Line | None = None


class NewPerson(BaseModel):
    """One entry for add_people. Links name people in the same batch (by ref) or existing ids."""

    ref: str | None = Field(
        None, description="Short label other entries use to link to this person. Defaults to name."
    )
    name: str
    sex: Sex | None = None
    birth_date: str | None = None
    death_date: str | None = None
    birth_place: str | None = None
    notes: str | None = None
    parents: list[str] = Field([], description="Refs in this batch or existing ids.")
    partners: list[str] = Field([], description="Refs in this batch or existing ids.")
    siblings: list[str] = Field([], description="Refs in this batch or existing ids.")


class Site(BaseModel):
    """Where a tree is published, and how."""

    project: str
    url: str
    hide_living: bool = True
    keep_updated: bool = True


class Tree(BaseModel):
    name: str
    description: str = ""
    site: Site | None = None
    people: dict[str, Person] = {}
    partnerships: dict[str, Partnership] = {}

    @model_validator(mode="after")
    def _repair(self) -> "Tree":
        """Drop links to missing people and make partner links two-way, e.g. after hand edits."""
        for key, person in self.people.items():
            valid = self.people.keys() - {key}
            person.id = key
            person.parents = [p for p in dict.fromkeys(person.parents) if p in valid][:2]
            person.partners = [p for p in dict.fromkeys(person.partners) if p in valid]
        for person in self.people.values():
            for partner in person.partners:
                if person.id not in self.people[partner].partners:
                    self.people[partner].partners.append(person.id)
        self.partnerships = {
            key: details
            for key, details in self.partnerships.items()
            if (pair := key.split("+"))[0] in self.people
            and len(pair) == 2
            and pair[1] in self.people[pair[0]].partners
        }
        return self

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

    def partnership(self, a: str, b: str) -> Partnership | None:
        return self.partnerships.get(pair_key(a, b))

    def half_siblings(self, a: str, b: str) -> bool:
        pa, pb = self.people[a].parents, self.people[b].parents
        return len(set(pa) & set(pb)) == 1 and max(len(pa), len(pb)) == 2

    def add_person(self, name: str, **fields: Any) -> Person:
        base = slugify(name) or "person"
        person_id, n = base, 1
        while person_id in self.people:
            n += 1
            person_id = f"{base}-{n}"
        person = Person(id=person_id, name=name, **fields)
        self.people[person_id] = person
        return person

    def add_people(self, batch: list[NewPerson]) -> dict[str, str]:
        """Add a batch of people and their links; return each entry's ref (or name) -> new id."""
        ids: dict[str, str] = {}
        for entry in batch:
            key = entry.ref or entry.name
            if key in ids:
                raise ValueError(f"'{key}' appears twice in the batch; give each a distinct ref.")
            ids[key] = self.add_person(entry.name, **entry.model_dump(include=set(DETAILS))).id

        def resolve(ref: str) -> str:
            if ref in ids:
                return ids[ref]
            if ref in self.people:
                return ref
            raise ValueError(
                f"Unknown person '{ref}'. Use a ref from this batch or an existing id."
            )

        # Parents first, so sibling links can copy them instead of adding placeholders.
        for relation in ("parent", "partner", "sibling"):
            for entry in batch:
                for ref in getattr(entry, f"{relation}s"):
                    self.link(ids[entry.ref or entry.name], relation, resolve(ref))
        return ids

    def update_person(self, person_id: str, **fields: Any) -> Person:
        person = self.get(person_id)
        if fields.get("name") == "":
            raise ValueError("A person's name can't be empty.")
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
        for key in [k for k in self.partnerships if person_id in k.split("+")]:
            del self.partnerships[key]

    def merge(self, keep_id: str, duplicate_id: str) -> Person:
        """Fold a duplicate into `keep_id`: fill missing details and move every link."""
        keep, dup = self.get(keep_id), self.get(duplicate_id)
        if keep_id == duplicate_id:
            raise ValueError("Choose two different people to merge.")
        if keep_id in self.ancestors(duplicate_id) or duplicate_id in self.ancestors(keep_id):
            raise ValueError(f"{keep.name} and {dup.name} are ancestor and descendant.")
        parents = keep.parents + [p for p in dup.parents if p not in keep.parents]
        if len(parents) > 2:
            raise ValueError(f"Merged, {keep.name} would have {len(parents)} parents.")
        for field in DETAILS:
            if getattr(keep, field) is None:
                setattr(keep, field, getattr(dup, field))
        if dup.notes and keep.notes and dup.notes not in keep.notes:
            keep.notes = f"{keep.notes}\n{dup.notes}"
        keep.parents = parents
        for partner in dup.partners:
            details = self.partnerships.pop(pair_key(duplicate_id, partner), None)
            if partner != keep_id:
                self.link(keep_id, "partner", partner)
                if details:
                    self.partnerships.setdefault(pair_key(keep_id, partner), details)
        for child in self.people.values():
            if duplicate_id in child.parents:
                child.parents = list(
                    dict.fromkeys(keep_id if p == duplicate_id else p for p in child.parents)
                )
        self.remove_person(duplicate_id)
        return keep

    def link(self, person_id: str, relation: Relation, relative_id: str, **details: Any) -> None:
        """Record that `relative_id` is `person_id`'s `relation`, with optional partner details."""
        person, relative = self.get(person_id), self.get(relative_id)
        if person_id == relative_id:
            raise ValueError("A person cannot be related to themselves.")
        if relation != "partner" and any(v is not None for v in details.values()):
            raise ValueError("Marriage details only apply to partner relationships.")
        if relation == "partner":
            if relative_id not in person.partners:
                person.partners.append(relative_id)
                relative.partners.append(person_id)
            return self._set_partnership(person_id, relative_id, **details)
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

    def _set_partnership(self, a: str, b: str, **details: str | None) -> None:
        if details.get("status") is None and not self.partnership(a, b):
            if details.get("divorce_date"):
                details["status"] = "divorced"
            elif details.get("marriage_date") or details.get("marriage_place"):
                details["status"] = "married"
        if all(v is None for v in details.values()):
            return
        partnership = self.partnerships.setdefault(pair_key(a, b), Partnership())
        for key, value in details.items():
            if value is not None:
                setattr(partnership, key, value or None)

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
            self.partnerships.pop(pair_key(person_id, relative_id), None)
        elif relation == "parent":
            person.parents = [i for i in person.parents if i != relative_id]
        else:
            relative.parents = [i for i in relative.parents if i != person_id]

    def find(self, query: str) -> list[Person]:
        terms = query.lower().split()
        return [p for p in self.people.values() if all(t in p.name.lower() for t in terms)]

    def profile(self, person_id: str) -> dict:
        person = self.get(person_id)
        partners = []
        for i in person.partners:
            details = self.partnership(person_id, i)
            partners.append(
                {**self.ref(i), **(details.model_dump(exclude_none=True) if details else {})}
            )
        return {
            **person.model_dump(exclude={"parents", "partners"}, exclude_none=True),
            "parents": [self.ref(i) for i in person.parents],
            "partners": partners,
            "children": [self.ref(i) for i in self.children(person_id)],
            "siblings": [
                {**self.ref(i), "half": True} if self.half_siblings(person_id, i) else self.ref(i)
                for i in self.siblings(person_id)
            ],
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
        result: dict[str, Any] = {"person": self.ref(a.id), "relative": self.ref(b.id)}
        if a.id == b.id:
            return {**result, "relationship": "same person"}
        if blood := self._blood(a.id, b.id):
            da, db, common = blood
            term = kinship(da, db, b.sex, da == db == 1 and self.half_siblings(a.id, b.id))
            if common := [self.ref(i) for i in common if i not in (a.id, b.id)]:
                result["common_ancestors"] = common
        elif b.id in a.partners:
            term = self._partner_term(a.id, b)
        elif via := next(((r, d) for r in b.partners if (d := self._blood(a.id, r))), None):
            # b is the partner of a's relative r.
            r, (da, db, _) = via
            former = "former " * self._divorced(r, b.id)
            named = by_marriage(da, db, b.sex)
            term = former + named if named else f"{self._term(a.id, r, da, db)}'s {former}partner"
        elif via := next(((p, d) for p in a.partners if (d := self._blood(p, b.id))), None):
            # b is a relative of a's partner p.
            p, (da, db, _) = via
            former = "former " * self._divorced(a.id, p)
            term = former + (in_law(da, db, b.sex) or f"partner's {self._term(p, b.id, da, db)}")
        else:
            return {**result, "relationship": "no known relationship"}
        return {**result, "relationship": term, "summary": f"{b.name} is {a.name}'s {term}."}

    def _divorced(self, a: str, b: str) -> bool:
        details = self.partnership(a, b)
        return bool(details and details.status == "divorced")

    def _partner_term(self, a: str, b: Person) -> str:
        status = (self.partnership(a, b.id) or Partnership()).status
        if status == "married":
            return _word(b.sex, "husband", "wife", "spouse")
        if status == "divorced":
            return _word(b.sex, "ex-husband", "ex-wife", "former spouse")
        return "partner"

    def _term(self, a: str, b: str, da: int, db: int) -> str:
        return kinship(da, db, self.people[b].sex, da == db == 1 and self.half_siblings(a, b))

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

    def _blood(self, a: str, b: str) -> tuple[int, int, list[str]] | None:
        """Generations from a and b up to their nearest common ancestors, and who those are."""
        up_a, up_b = self.ancestors(a), self.ancestors(b)
        common = up_a.keys() & up_b.keys()
        if not common:
            return None
        best = min(up_a[i] + up_b[i] for i in common)
        nearest = sorted(i for i in common if up_a[i] + up_b[i] == best)
        return up_a[nearest[0]], up_b[nearest[0]], nearest


def kinship(da: int, db: int, sex: Sex | None, half: bool = False) -> str:
    """Name B's relation to A from each one's generations (da, db) up to a common ancestor."""
    if da == 0:
        return _grand(db) + _word(sex, "son", "daughter", "child")
    if db == 0:
        return _grand(da) + _word(sex, "father", "mother", "parent")
    if da == db == 1:
        return ("half-" if half else "") + _word(sex, "brother", "sister", "sibling")
    if da == 1:
        return "great-" * (db - 2) + _word(sex, "nephew", "niece", "niece/nephew")
    if db == 1:
        return "great-" * (da - 2) + _word(sex, "uncle", "aunt", "aunt/uncle")
    degree, removed = min(da, db) - 1, abs(da - db)
    term = f"{_ordinal(degree)} cousin"
    if removed:
        term += {1: " once removed", 2: " twice removed"}.get(removed, f" {removed} times removed")
    return term


def by_marriage(da: int, db: int, sex: Sex | None) -> str | None:
    """Name the partner of A's relative R, where (da, db) is R's blood relation to A."""
    names = {
        (1, 0): ("stepfather", "stepmother", "step-parent"),
        (1, 1): ("brother-in-law", "sister-in-law", "sibling-in-law"),
        (0, 1): ("son-in-law", "daughter-in-law", "child-in-law"),
        (2, 1): ("uncle by marriage", "aunt by marriage", "aunt/uncle by marriage"),
    }
    return _word(sex, *names[(da, db)]) if (da, db) in names else None


def in_law(da: int, db: int, sex: Sex | None) -> str | None:
    """Name a relative B of A's partner P, where (da, db) is B's blood relation to P."""
    names = {
        (1, 0): ("father-in-law", "mother-in-law", "parent-in-law"),
        (1, 1): ("brother-in-law", "sister-in-law", "sibling-in-law"),
        (0, 1): ("stepson", "stepdaughter", "stepchild"),
    }
    return _word(sex, *names[(da, db)]) if (da, db) in names else None


def _word(sex: Sex | None, male: str, female: str, neutral: str) -> str:
    return {"male": male, "female": female}.get(sex or "", neutral)


def _grand(generations: int) -> str:
    return "" if generations == 1 else "great-" * (generations - 2) + "grand"


def _ordinal(n: int) -> str:
    words = {1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth"}
    return words.get(n, f"{n}th")


def pair_key(a: str, b: str) -> str:
    return "+".join(sorted((a, b)))


def birth_key(date: str | None) -> tuple[int, str]:
    """Sort key from the first YYYY, YYYY-MM or YYYY-MM-DD in a free-text date; unknown last."""
    match = re.search(r"\d{4}(?:-\d{2}){0,2}", date or "")
    return (0, match.group()) if match else (1, "")


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
