import { assert, emptyCollection, pair, validateCollection, type Person } from "./model";
import { digest } from "./backup";

interface Node { tag: string; value: string; pointer?: string; children: Node[] }
const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const child = (node: Node, tag: string) => node.children.find(item => item.tag === tag);
function value(node?: Node): string {
  if (!node) return "";
  return node.value.replaceAll("@@","@") + node.children.filter(item => item.tag === "CONT" || item.tag === "CONC").map(item => `${item.tag === "CONT" ? "\n" : ""}${value(item)}`).join("");
}
function date(node?: Node) {
  const text = value(node);
  const match = /^(?:(\d{1,2}) )?(?:([A-Z]{3}) )?(\d{4})$/.exec(text);
  if (!match) return text;
  const month = match[2] ? months.indexOf(match[2])+1 : 0;
  if (match[2] && !month) return text;
  return `${match[3]}${month ? `-${String(month).padStart(2,"0")}` : ""}${match[1] && month ? `-${match[1].padStart(2,"0")}` : ""}`;
}
export async function previewGedcom(source: string, name: string) {
  assert(source.length <= 1_000_000, "Choose a GEDCOM file smaller than 1 MB.", 413);
  const roots: Node[] = [], stack: Node[] = [], pointers = new Set<string>(), warnings = new Set<string>();
  let previousLevel = 0;
  for (const [index, line] of source.replace(/^\uFEFF/,"").split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const match = /^(\d+) (?:(@[^@\s]+@) )?([A-Za-z0-9_]+)(?: (.*))?$/.exec(line);
    assert(match, `Invalid GEDCOM line ${index+1}.`);
    const level = Number(match[1]);
    assert(level <= 10 && level <= previousLevel+1 && (!level || stack[level-1]), `Invalid nesting on line ${index+1}.`);
    previousLevel = level;
    const node: Node = { pointer: match[2], tag: match[3].toUpperCase(), value: match[4] || "", children: [] };
    if (node.pointer) { assert(!pointers.has(node.pointer), "Duplicate GEDCOM record identifiers."); pointers.add(node.pointer); }
    (level ? stack[level-1].children : roots).push(node); stack[level] = node; stack.length = level+1;
  }
  assert(roots[0]?.tag === "HEAD" && roots.at(-1)?.tag === "TRLR", "Choose a complete GEDCOM file with HEAD and TRLR records.");
  const encoding = value(child(roots[0],"CHAR"));
  assert(!encoding || encoding === "UTF-8" || encoding === "ASCII", "Convert this GEDCOM to UTF-8 before importing.");
  const consumed = new Set<Node>();
  const read = (node: Node, tag: string) => { const found=child(node,tag); if(found) consumed.add(found); return found; };
  const markHeader = (node: Node) => { consumed.add(node); node.children.forEach(markHeader); };
  markHeader(roots[0]); consumed.add(roots.at(-1)!);
  const eventDate = (event?: Node) => {
    if (!event) return "";
    const note=child(event,"NOTE");
    if (value(note).startsWith("Date: ")) { consumed.add(note!); return value(note).slice(6); }
    return date(read(event,"DATE"));
  };
  const collection = emptyCollection(), ids = new Map<string,string>();
  const treeId = crypto.randomUUID();
  collection.trees[treeId] = { id: treeId, name, members: [] };
  const people = roots.filter(node => node.tag === "INDI");
  assert(people.length > 0 && people.length <= 10000, "Import 1–10,000 people.");
  for (const record of people) {
    consumed.add(record);
    assert(record.pointer,"A person is missing its record identifier.");
    const id = crypto.randomUUID(); ids.set(record.pointer,id);
    const birth = read(record,"BIRT"), death = read(record,"DEAT"), sex = value(read(record,"SEX"));
    if (sex && sex !== "M" && sex !== "F") warnings.add(`Unrecognized gender ${sex}: left unspecified.`);
    const notes = record.children.filter(node => node.tag === "NOTE").map(node => { consumed.add(node); return value(node); });
    const sourceId = value(read(record,"_UID"));
    if (sourceId) notes.push(`Source identifier: ${sourceId}`);
    const person: Person = { id, name: value(read(record,"NAME")).replaceAll("/","").trim(), parents: [], partners: [],
      ...sex === "M" ? {sex:"male"} : sex === "F" ? {sex:"female"} : {},
      birth_date: eventDate(birth) || null, death_date: eventDate(death) || null,
      birth_place: value(birth && read(birth,"PLAC")) || null, notes: notes.join("\n") || null };
    assert(person.name,"Every imported person needs a name."); collection.people[id] = person; collection.trees[treeId].members.push(id);
  }
  for (const family of roots.filter(node => node.tag === "FAM")) {
    consumed.add(family);
    const resolve = (tag: string) => family.children.filter(node => node.tag === tag).map(node => {
      consumed.add(node);
      const id = ids.get(node.value); assert(id, `Unresolved ${tag} reference ${node.value}.`); return id;
    });
    const parents = [...resolve("HUSB"),...resolve("WIFE")];
    assert(parents.length <= 2 && new Set(parents).size === parents.length,"A family has invalid parent records.");
    for (const id of resolve("CHIL")) collection.people[id].parents.push(...parents);
    const marriage = read(family,"MARR"), divorce = read(family,"DIV");
    const noteNode = child(family,"NOTE"), note = value(noteNode);
    if (note.startsWith("Relationship: ")) consumed.add(noteNode!);
    const recordedPartnership = read(family,"_PARTNERS") || marriage || divorce || note.startsWith("Relationship: ");
    if (parents.length === 2 && recordedPartnership) {
      const [a,b] = parents;
      collection.people[a].partners.push(b); collection.people[b].partners.push(a);
      const status = divorce ? "divorced" : marriage ? "married" : note.startsWith("Relationship: ") ? note.slice(14) : "partners";
      collection.partnerships[pair(a,b)] = { status, marriage_date: eventDate(marriage) || null, marriage_place: value(marriage && read(marriage,"PLAC")) || null, divorce_date: eventDate(divorce) || null };
    }
  }
  for (const p of Object.values(collection.people)) { p.parents = [...new Set(p.parents)]; p.partners = [...new Set(p.partners)]; }
  const visit = (node: Node, parent?: Node) => {
    if (parent && consumed.has(parent) && (node.tag === "CONT" || node.tag === "CONC")) consumed.add(node);
    if (!consumed.has(node)) warnings.add(`Not imported: ${parent ? `${parent.tag}.` : ""}${node.tag}.`);
    node.children.forEach(item => visit(item,node));
  };
  roots.forEach(node=>visit(node));
  validateCollection(collection);
  return { collection, treeId, warnings: [...warnings], checksum: await digest(new TextEncoder().encode(source)), people: people.length };
}
