import { assert, emptyCollection, pair, validateCollection, type Person } from "./model";
import { digest } from "./backup";
import { MAX_COLLECTION_PEOPLE } from "./import-limits";
import { decodeGedcom } from "./gedcom-decoding";
import { child, gedcomText, importWarnings, parseGedcom, type GedcomNode as Node } from "./gedcom-format";

const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
export async function previewGedcom(input: string | Uint8Array, name: string) {
  assert(typeof input === "string" || input instanceof Uint8Array, "Choose a GEDCOM file.");
  const decoded = decodeGedcom(input);
  const { roots, pointers, version, modern } = parseGedcom(decoded.source);
  assert(!modern || decoded.encoding === "UTF-8" && (!decoded.declared || ["UTF-8", "UTF8"].includes(decoded.declared)), "GEDCOM 7 requires UTF-8. Export this file as UTF-8 GEDCOM 7.");
  const warnings = importWarnings(), consumed = new Set<Node>();
  const statistics = { unnamedPeople: 0, notes: 0, families: 0, skippedParentLinks: 0, omittedFields: 0 };
  if (decoded.textInput && decoded.declared && !["UTF-8", "UTF8", "ASCII"].includes(decoded.declared)) {
    warnings.add("The API supplied decoded Unicode text; the legacy encoding declaration was not used to decode it again.");
  }
  const text = (node?: Node) => gedcomText(node, modern);
  const read = (node: Node, tag: string) => { const found = child(node, tag); if (found) consumed.add(found); return found; };
  const mark = (node: Node) => { consumed.add(node); node.children.forEach(mark); };
  mark(roots[0]); consumed.add(roots.at(-1)!);
  const date = (node?: Node) => {
    const value = text(node), match = /^(?:(\d{1,2}) )?(?:([A-Z]{3}) )?(\d{4})$/.exec(value);
    if (!match) return value || text(node && read(node, "PHRASE"));
    const month = match[2] ? months.indexOf(match[2]) + 1 : 0;
    if (match[2] && !month) return value;
    return `${match[3]}${month ? `-${String(month).padStart(2,"0")}` : ""}${match[1] && month ? `-${match[1].padStart(2,"0")}` : ""}`;
  };
  const noteCache = new Map<Node, string>();
  const noteText = (node: Node, visiting = new Set<Node>()): string => {
    const cached = noteCache.get(node); if (cached !== undefined) return cached;
    assert(!visiting.has(node) && visiting.size < 64, `Cyclic or excessively nested shared note on line ${node.line}.`);
    visiting.add(node); consumed.add(node);
    let value: string;
    if (/^@[^@\s]+@$/.test(node.value)) {
      const target = pointers.get(node.value);
      assert(target && ["NOTE", "SNOTE"].includes(target.tag), `Unresolved shared note reference on line ${node.line}.`);
      value = noteText(target, visiting);
    } else value = text(node);
    visiting.delete(node); noteCache.set(node, value); return value;
  };
  const eventDate = (event?: Node) => {
    if (!event) return "";
    const note = child(event, "NOTE");
    if (note && text(note).startsWith("Date: ")) return noteText(note).slice(6);
    return date(read(event, "DATE"));
  };
  const collection = emptyCollection(), ids = new Map<string, string>();
  const treeId = crypto.randomUUID();
  collection.trees[treeId] = { id: treeId, name, members: [] };
  const people = roots.filter(node => node.tag === "INDI");
  assert(people.length > 0 && people.length <= MAX_COLLECTION_PEOPLE, "Import 1–10,000 people.");
  for (const record of people) {
    consumed.add(record);
    assert(record.pointer, `A person is missing its record identifier on line ${record.line}.`);
    const id = crypto.randomUUID(); ids.set(record.pointer, id);
    const birth = read(record, "BIRT"), death = read(record, "DEAT"), sex = text(read(record, "SEX")).trim().toUpperCase();
    if (sex && sex !== "M" && sex !== "F") warnings.add("Unrecognized or unspecified gender: left unspecified.");
    const notes = record.children.filter(n => n.tag === "NOTE" || n.tag === "SNOTE").map(n => { statistics.notes++; return noteText(n); });
    const sourceId = text(read(record, "_UID"));
    if (sourceId) notes.push(`Source identifier: ${sourceId}`);
    const nameNode = read(record, "NAME");
    let personName = text(nameNode).replaceAll("/", "").trim();
    if (!personName && nameNode) personName = [text(read(nameNode,"GIVN")), text(read(nameNode,"SURN"))].filter(Boolean).join(" ").trim();
    if (!personName) { personName = "Unknown"; statistics.unnamedPeople++; warnings.add("An unnamed person was imported as Unknown."); }
    const person: Person = { id, name: personName, parents: [], partners: [],
      ...sex === "M" ? { sex: "male" } : sex === "F" ? { sex: "female" } : {},
      birth_date: eventDate(birth) || null, death_date: eventDate(death) || null,
      birth_place: text(birth && read(birth, "PLAC")) || null, notes: notes.join("\n") || null };
    collection.people[id] = person; collection.trees[treeId].members.push(id);
  }
  const families = roots.filter(n => n.tag === "FAM");
  statistics.families = families.length;
  const familyRecords = new Map(families.map(n => [n.pointer, n]));
  const children = new Map<Node, Map<string, string>>(), spouses = new Map<Node, Set<string>>();
  const addChild = (family: Node, id: string, pedigree = "") => {
    const members = children.get(family) || new Map<string, string>();
    const previous = members.get(id);
    assert(!previous || !pedigree || previous === pedigree, `Conflicting parentage types on line ${family.line}.`);
    members.set(id, pedigree || previous || ""); children.set(family, members);
  };
  const addSpouse = (family: Node, id: string) => {
    const members = spouses.get(family) || new Set<string>(); members.add(id); spouses.set(family, members);
  };
  for (const family of families) {
    consumed.add(family); assert(family.pointer, `A family is missing its record identifier on line ${family.line}.`);
    const roleParents: string[] = [];
    for (const node of family.children.filter(n => ["HUSB", "WIFE", "CHIL"].includes(n.tag))) {
      consumed.add(node);
      if (modern && node.value === "@VOID@") { warnings.add("An unspecified family reference was omitted."); continue; }
      const id = ids.get(node.value); assert(id, `Unresolved ${node.tag} reference on line ${node.line}.`);
      if (node.tag === "CHIL") addChild(family, id);
      else { roleParents.push(id); addSpouse(family, id); }
    }
    assert(new Set(roleParents).size === roleParents.length, `A family has duplicate parent records on line ${family.line}.`);
  }
  for (const record of people) {
    const id = ids.get(record.pointer!)!;
    const adopted = new Set(record.children.filter(n => n.tag === "ADOP").flatMap(n => n.children.filter(c => c.tag === "FAMC").map(c => c.value)));
    for (const node of record.children.filter(n => n.tag === "FAMC" || n.tag === "FAMS")) {
      consumed.add(node);
      if (modern && node.value === "@VOID@") { warnings.add("An unspecified family reference was omitted."); continue; }
      const family = familyRecords.get(node.value);
      assert(family, `Unresolved family reference on line ${node.line}.`);
      if (node.tag === "FAMS") addSpouse(family, id);
      else {
        const pedigree = text(read(node, "PEDI")).trim().toUpperCase();
        assert(!(pedigree === "BIRTH" && adopted.has(node.value)), `Conflicting birth and adoption records on line ${node.line}.`);
        addChild(family, id, pedigree || (adopted.has(node.value) ? "ADOPTED" : ""));
      }
    }
    // Some exporters put the adoption family only under the ADOP event.
    for (const pointer of adopted) {
      const family = familyRecords.get(pointer);
      assert(family, `Unresolved adoption family reference on line ${record.line}.`);
      addChild(family, id, "ADOPTED");
    }
  }
  for (const family of families) {
    const parents = [...spouses.get(family) || []];
    assert(parents.length <= 2, `A family has more than two parents on line ${family.line}.`);
    for (const [id, pedigree] of children.get(family) || []) {
      if (pedigree && pedigree !== "BIRTH") {
        statistics.skippedParentLinks += parents.length;
        warnings.add("Adoptive, foster or other non-birth parent links were omitted; this app cannot label them correctly.");
      } else collection.people[id].parents.push(...parents);
    }
    const marriage = read(family, "MARR"), divorce = read(family, "DIV");
    const noteNode = child(family, "NOTE"), note = noteNode && text(noteNode).startsWith("Relationship: ") ? noteText(noteNode) : "";
    if (parents.length === 2) {
      const [a,b] = parents, key = pair(a,b);
      collection.people[a].partners.push(b); collection.people[b].partners.push(a);
      const recordedStatus = note.startsWith("Relationship: ") ? note.slice(14) : "partners";
      const status = divorce ? "divorced" : marriage ? "married" : ["married", "partners", "divorced"].includes(recordedStatus) ? recordedStatus : "partners";
      if (collection.partnerships[key]) warnings.add("Multiple family records describe the same couple; the first union details were retained.");
      else collection.partnerships[key] = { status, marriage_date: eventDate(marriage) || null,
        marriage_place: text(marriage && read(marriage, "PLAC")) || null, divorce_date: eventDate(divorce) || null };
    }
  }
  for (const p of Object.values(collection.people)) {
    p.parents = [...new Set(p.parents)]; p.partners = [...new Set(p.partners)];
    if (p.parents.length > 2) {
      statistics.skippedParentLinks += p.parents.length; p.parents = [];
      warnings.add("Conflicting or multiple parent families exceed the app’s two-parent limit; those parent links were omitted.");
    }
  }
  const visit = (node: Node, parent?: Node) => {
    if (parent && consumed.has(parent) && (node.tag === "CONT" || !modern && node.tag === "CONC")) consumed.add(node);
    if (!consumed.has(node)) { statistics.omittedFields++; warnings.add(`Not imported: ${parent ? `${parent.tag.slice(0, 40)}.` : ""}${node.tag.slice(0, 40)}.`); }
    node.children.forEach(item => visit(item, node));
  };
  roots.forEach(node => visit(node));
  validateCollection(collection);
  return { collection, treeId, warnings: warnings.list(), statistics, encoding: decoded.encoding, version,
    checksum: await digest(decoded.bytes), people: people.length };
}
