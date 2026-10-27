export interface Person {
  id: string;
  name: string;
  sex?: "male" | "female" | null;
  birth_date?: string | null;
  death_date?: string | null;
  birth_place?: string | null;
  notes?: string | null;
  parents: string[];
  partners: string[];
}
export interface Family { id: string; name: string; description?: string; members: string[] }
export interface Collection {
  version: 1;
  people: Record<string, Person>;
  partnerships: Record<string, { status?: string | null; marriage_date?: string | null; marriage_place?: string | null; divorce_date?: string | null }>;
  trees: Record<string, Family>;
  site: { name: string; url?: string } | null;
}
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function assert(condition: unknown, message: string, status = 400): asserts condition {
  if (!condition) throw new HttpError(status, message);
}
export const uuid = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
export const line = (text: string) => text.trim().replace(/\s+/g, " ");
export const pair = (a: string, b: string) => [a, b].sort().join("+");
export const emptyCollection = (): Collection => ({ version: 1, people: {}, partnerships: {}, trees: {}, site: null });

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function validateCollection(value: unknown): asserts value is Collection {
  const c = value as Collection;
  assert(record(value), "Invalid collection.");
  assert(c.version === 1 && record(c.people) && record(c.trees) && record(c.partnerships), "Unsupported collection.");
  assert(Object.keys(c).every(key => ["version", "people", "trees", "partnerships", "site"].includes(key)), "Unknown collection field.");
  assert(c.site === null || record(c.site), "Invalid website settings.");
  if (c.site) {
    assert(Object.keys(c.site).every(key => ["name", "url"].includes(key)), "Unsupported website setting.");
    assert(typeof c.site.name === "string" && c.site.name.trim().length > 0 && c.site.name.length <= 200, "Invalid website name.");
    assert(c.site.url == null || typeof c.site.url === "string" && c.site.url.length <= 2000, "Invalid website URL.");
  }
  assert(Object.keys(c.people).length <= 10000, "This collection is too large.");
  for (const [id, p] of Object.entries(c.people)) {
    assert(record(p) && uuid(id) && p.id === id, "Person IDs must be UUIDs.");
    assert(typeof p.name === "string" && line(p.name).length > 0 && p.name.length <= 200, "Enter a name of at most 200 characters.");
    assert(p.sex == null || ["male", "female"].includes(p.sex), "Invalid gender.");
    for (const key of ["birth_date", "death_date", "birth_place", "notes"] as const) {
      assert(p[key] == null || (typeof p[key] === "string" && p[key]!.length <= (key === "notes" ? 5000 : 300)), `Invalid ${key}.`);
    }
    for (const key of ["parents", "partners"] as const) {
      assert(Array.isArray(p[key]) && p[key].every(other => uuid(other) && other !== id && c.people[other]) && new Set(p[key]).size === p[key].length, "Invalid family connections.");
    }
    assert(p.parents.length <= 2, "A person can have at most two parents.");

  }
  for (const [id, p] of Object.entries(c.people)) {
    assert(p.partners.every(other => c.people[other].partners.includes(id)), "Partner connections must be reciprocal.");
  }
  const visited = new Set<string>(), visiting = new Set<string>();
  for (const root of Object.keys(c.people)) {
    const stack: [string, boolean][] = [[root, false]];
    while (stack.length) {
      const [id, done] = stack.pop()!;
      if (done) { visiting.delete(id); visited.add(id); continue; }
      if (visited.has(id)) continue;
      assert(!visiting.has(id), "A person cannot be their own ancestor.");
      visiting.add(id); stack.push([id, true]);
      for (const parent of c.people[id].parents) stack.push([parent, false]);
    }
  }
  for (const [id, t] of Object.entries(c.trees)) {
    assert(record(t) && uuid(id) && t.id === id && typeof t.name === "string" && line(t.name).length > 0 && t.name.length <= 200, "Invalid family tree.");
    assert(t.description == null || typeof t.description === "string" && t.description.length <= 5000, "Invalid tree description.");
    assert(Array.isArray(t.members) && new Set(t.members).size === t.members.length && t.members.every(p => uuid(p) && c.people[p]), "Invalid tree members.");
  }
  for (const [key, details] of Object.entries(c.partnerships)) {
    const [a, b] = key.split("+");
    assert(record(details) && c.people[a]?.partners.includes(b) && key === pair(a, b), "Invalid partnership details.");
    assert(details.status == null || ["married", "partners", "divorced"].includes(details.status), "Invalid partnership status.");
    for (const field of ["marriage_date", "marriage_place", "divorce_date"] as const) {
      assert(details[field] == null || (typeof details[field] === "string" && details[field]!.length <= 300), "Invalid partnership details.");
    }
  }
}

export function applyPersonEdit(c: Collection, id: string, fields: unknown) {
  assert(uuid(id), "Person not found.", 404);
  const p = c.people[id];
  assert(p, "Person not found.", 404);
  assert(record(fields), "Enter valid person details.");
  for (const key of Object.keys(fields)) {
    assert(["name", "sex", "birth_date", "death_date", "birth_place", "notes"].includes(key), "Unknown person field.");
    const value = fields[key];
    assert(value == null || typeof value === "string", "Invalid person details.");
    (p as unknown as Record<string, unknown>)[key] = value === "" ? null : typeof value === "string" && key !== "notes" ? line(value) : value;
  }
}

export function applyLink(c: Collection, a: string, b: string, relation: unknown, remove = false, status?: unknown) {
  assert(uuid(a) && uuid(b) && c.people[a] && c.people[b] && a !== b, "Choose two different people.");
  assert(typeof relation === "string" && ["parent", "child", "partner"].includes(relation), "Choose parent, child, or partner.");
  assert(status == null || typeof status === "string" && ["married", "partners", "divorced"].includes(status), "Invalid partnership status.");
  if (relation === "child") return applyLink(c, b, a, "parent", remove);
  const update = (ids: string[], id: string) => remove ? ids.filter(p => p !== id) : [...new Set([...ids, id])];
  if (relation === "parent") c.people[a].parents = update(c.people[a].parents, b);
  else {
    c.people[a].partners = update(c.people[a].partners, b);
    c.people[b].partners = update(c.people[b].partners, a);
    if (remove) delete c.partnerships[pair(a, b)];
    else if (status) c.partnerships[pair(a, b)] = { ...c.partnerships[pair(a, b)], status };
  }
}
