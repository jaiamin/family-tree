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
  const collection = emptyCollection(), ids = new Map<string,string>();
  const treeId = crypto.randomUUID();
  collection.trees[treeId] = { id: treeId, name, members: [] };
  const supported = new Set(["HEAD","SOUR","NAME","GEDC","VERS","FORM","CHAR","SUBM","TRLR","INDI","SEX","BIRT","DEAT","DATE","PLAC","NOTE","CONT","CONC","_UID","FAMC","FAMS","FAM","HUSB","WIFE","CHIL","MARR","DIV","_PARTNERS"]);
  const visit = (node: Node) => { if (!supported.has(node.tag)) warnings.add(`Unsupported ${node.tag}: not imported.`); node.children.forEach(visit); };
  roots.forEach(visit);
  const people = roots.filter(node => node.tag === "INDI");
  assert(people.length > 0 && people.length <= 10000, "Import 1–10,000 people.");
  for (const record of people) {
    assert(record.pointer,"A person is missing its record identifier.");
    const id = crypto.randomUUID(); ids.set(record.pointer,id);
    const birth = child(record,"BIRT"), death = child(record,"DEAT"), sex = value(child(record,"SEX"));
    if (sex && sex !== "M" && sex !== "F") warnings.add(`Unrecognized gender ${sex}: left unspecified.`);
    const notes = record.children.filter(node => node.tag === "NOTE").map(node => value(node));
    const sourceId = value(child(record,"_UID"));
    if (sourceId) notes.push(`Source identifier: ${sourceId}`);
    const eventDate = (event?: Node) => value(child(event || record,"NOTE")).startsWith("Date: ") ? value(child(event!,"NOTE")).slice(6) : date(event && child(event,"DATE"));
    const person: Person = { id, name: value(child(record,"NAME")).replaceAll("/","").trim(), parents: [], partners: [],
      ...sex === "M" ? {sex:"male"} : sex === "F" ? {sex:"female"} : {},
      birth_date: eventDate(birth) || null, death_date: eventDate(death) || null,
      birth_place: value(birth && child(birth,"PLAC")) || null, notes: notes.join("\n") || null };
    assert(person.name,"Every imported person needs a name."); collection.people[id] = person; collection.trees[treeId].members.push(id);
  }
  for (const family of roots.filter(node => node.tag === "FAM")) {
    const resolve = (tag: string) => family.children.filter(node => node.tag === tag).map(node => {
      const id = ids.get(node.value); assert(id, `Unresolved ${tag} reference ${node.value}.`); return id;
    });
    const parents = [...resolve("HUSB"),...resolve("WIFE")];
    assert(parents.length <= 2 && new Set(parents).size === parents.length,"A family has invalid parent records.");
    for (const id of resolve("CHIL")) collection.people[id].parents.push(...parents);
    const marriage = child(family,"MARR"), divorce = child(family,"DIV");
    const note = value(child(family,"NOTE"));
    const recordedPartnership = child(family,"_PARTNERS") || marriage || divorce || note.startsWith("Relationship: ");
    if (parents.length === 2 && recordedPartnership) {
      const [a,b] = parents;
      collection.people[a].partners.push(b); collection.people[b].partners.push(a);
      const status = divorce ? "divorced" : marriage ? "married" : note.startsWith("Relationship: ") ? note.slice(14) : "partners";
      collection.partnerships[pair(a,b)] = { status, marriage_date: date(marriage && child(marriage,"DATE")) || null, marriage_place: value(marriage && child(marriage,"PLAC")) || null, divorce_date: date(divorce && child(divorce,"DATE")) || null };
    }
  }
  for (const p of Object.values(collection.people)) { p.parents = [...new Set(p.parents)]; p.partners = [...new Set(p.partners)]; }
  validateCollection(collection);
  return { collection, treeId, warnings: [...warnings], checksum: await digest(new TextEncoder().encode(source)), people: people.length };
}
