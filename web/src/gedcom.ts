import type { Person, Collection } from "./model";

type Tree = { name: string; people: Record<string, Person>; partnerships: Collection["partnerships"] };
const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function gedcom(tree: Tree): string {
  const lines: string[] = [], encoder = new TextEncoder();
  const add = (level: number, tag: string, value = "") => {
    const parts = value.replace(/\r\n?/g, "\n").replaceAll("@", "@@").split("\n");
    for (const [index, part] of parts.entries()) {
      let prefix = `${index ? level + 1 : level} ${index ? "CONT" : tag}`, chunk = prefix;
      for (const char of part.match(/@@|[\s\S]/gu) || []) {
        if (encoder.encode(`${chunk} ${char}`).length > 240) {
          lines.push(chunk); prefix = `${level + 1} CONC`; chunk = prefix;
        }
        chunk += (chunk === prefix ? " " : "") + char;
      }
      lines.push(chunk);
    }
  };
  // Pointers are syntax, not text: do not escape their @ delimiters.
  const pointer = (level: number, tag: string, id: string) => lines.push(`${level} ${tag} @${id}@`);
  const event = (tag: string, date?: string | null, place?: string | null) => {
    if (!date && !place) return;
    lines.push(`1 ${tag}`);
    if (date) {
      const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(date);
      const month = match?.[2], day = match?.[3];
      const iso = match ? `${match[1]}-${month || "01"}-${day || "01"}` : "";
      const parsed = new Date(`${iso}T00:00:00Z`);
      if (match && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso) {
        add(2, "DATE", [day && String(Number(day)), month && months[Number(month) - 1], match[1]].filter(Boolean).join(" "));
      } else add(2, "NOTE", `Date: ${date}`);
    }
    if (place) add(2, "PLAC", place);
  };
  const people = Object.values(tree.people), ids = new Map(people.map((p, i) => [p.id, `I${i + 1}`]));
  const families = new Map<string, { id: string; parents: string[]; children: string[] }>();
  const family = (parents: string[]) => {
    const key = [...parents].sort().join("+");
    if (!families.has(key)) families.set(key, { id: `F${families.size + 1}`, parents: [...parents].sort(), children: [] });
    return families.get(key)!;
  };
  for (const p of people) {
    for (const partner of p.partners) if (ids.has(partner)) family([p.id, partner]);
    const parents = p.parents.filter(id => ids.has(id));
    if (parents.length) family(parents).children.push(p.id);
  }
  lines.push("0 HEAD", "1 SOUR FAMILY_TREE", "2 NAME Family Tree", "1 GEDC", "2 VERS 5.5.1", "2 FORM LINEAGE-LINKED", "1 CHAR UTF-8", "1 SUBM @SUB1@");
  add(1, "NOTE", tree.name);
  lines.push("0 @SUB1@ SUBM", "1 NAME Family Tree");
  const asParent = new Map<string, string[]>(), asChild = new Map<string, string[]>();
  for (const f of families.values()) {
    for (const [members, index] of [[f.parents, asParent], [f.children, asChild]] as const) {
      for (const id of members) index.set(id, [...index.get(id) || [], f.id]);
    }
  }
  for (const p of people) {
    lines.push(`0 @${ids.get(p.id)}@ INDI`);
    add(1, "NAME", p.name); add(1, "_UID", p.id);
    if (p.sex) add(1, "SEX", p.sex === "male" ? "M" : "F");
    event("BIRT", p.birth_date, p.birth_place); event("DEAT", p.death_date);
    if (p.notes) add(1, "NOTE", p.notes);
    for (const id of asChild.get(p.id) || []) pointer(1, "FAMC", id);
    for (const id of asParent.get(p.id) || []) pointer(1, "FAMS", id);
  }
  for (const [key, f] of families) {
    lines.push(`0 @${f.id}@ FAM`);
    // GEDCOM calls these slots HUSB/WIFE, including unmarried parents.
    const parents = [...f.parents].sort((a, b) => Number(tree.people[a].sex === "female") - Number(tree.people[b].sex === "female"));
    for (const [i, id] of parents.entries()) pointer(1, parents.length === 1 && tree.people[id].sex === "female" ? "WIFE" : i ? "WIFE" : "HUSB", ids.get(id)!);
    for (const id of f.children) pointer(1, "CHIL", ids.get(id)!);
    const partnership = tree.partnerships[key];
    if (f.parents.length === 2 && tree.people[f.parents[0]].partners.includes(f.parents[1])) add(1,"_PARTNERS","Y");
    if (partnership?.status === "married" || partnership?.marriage_date || partnership?.marriage_place) {
      if (!partnership.marriage_date && !partnership.marriage_place) lines.push("1 MARR Y");
      else event("MARR", partnership.marriage_date, partnership.marriage_place);
    }
    if (partnership?.status && partnership.status !== "married") add(1, "NOTE", `Relationship: ${partnership.status}`);
    event("DIV", partnership?.divorce_date);
  }
  lines.push("0 TRLR");
  return lines.join("\r\n") + "\r\n";
}
