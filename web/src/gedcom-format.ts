import { assert } from "./model";
import { MAX_GEDCOM_LINES } from "./import-limits";

export interface GedcomNode { tag: string; value: string; pointer?: string; children: GedcomNode[]; line: number }
export const child = (node: GedcomNode, tag: string) => node.children.find(item => item.tag === tag);

export function parseGedcom(source: string) {
  const roots: GedcomNode[] = [], stack: GedcomNode[] = [], pointers = new Map<string, GedcomNode>();
  let previousLevel = 0, index = 0;
  for (const match of source.replace(/^\uFEFF/, "").matchAll(/([^\r\n]*)(?:\r\n|\r|\n|$)/g)) {
    // A final line terminator does not add a phantom empty line.
    if (!match[0]) continue;
    assert(++index <= MAX_GEDCOM_LINES, "Import a GEDCOM file with at most 100,000 lines.", 413);
    const line = match[1];
    if (!line.trim()) continue;
    const parts = /^(\d+) (?:(@[^@\s]+@) )?([A-Za-z0-9_]+)(?: ([\s\S]*))?$/.exec(line);
    assert(parts, `Invalid GEDCOM line ${index}: expected a level, tag and optional value.`);
    const level = Number(parts[1]);
    assert(level <= 64 && level <= previousLevel + 1 && (!level || stack[level - 1]), `Invalid nesting on line ${index}. Maximum depth is 64.`);
    assert(!parts[2] || !level, `Record identifiers must be at level 0 (line ${index}).`);
    previousLevel = level;
    const node: GedcomNode = { pointer: parts[2], tag: parts[3].toUpperCase(), value: parts[4] || "", children: [], line: index };
    if (node.pointer) {
      assert(!pointers.has(node.pointer), `Duplicate GEDCOM record identifier on line ${index}.`);
      pointers.set(node.pointer, node);
    }
    (level ? stack[level - 1].children : roots).push(node);
    stack[level] = node; stack.length = level + 1;
  }
  assert(roots[0]?.tag === "HEAD" && roots.at(-1)?.tag === "TRLR" && roots.filter(n => n.tag === "HEAD" || n.tag === "TRLR").length === 2,
    "Choose a complete GEDCOM file with one HEAD record and a final TRLR record. HTML pages and ZIP files cannot be imported.");
  assert(!roots[0].pointer && !roots.at(-1)!.pointer && !roots.at(-1)!.children.length && !roots.at(-1)!.value.trim(), "Invalid GEDCOM header or trailer.");
  const version = child(roots[0], "GEDC")?.children.find(n => n.tag === "VERS")?.value.trim() || "unspecified";
  assert(["unspecified", "5.5", "5.5.1", "5.5.5"].includes(version) || /^7\.0(?:\.\d+)?$/.test(version), "Unsupported GEDCOM version. Export GEDCOM 5.5.1 or 7.0.");
  return { roots, pointers, version, modern: version.startsWith("7.") };
}

export function gedcomText(node: GedcomNode | undefined, modern: boolean): string {
  if (!node) return "";
  const value = modern ? node.value.replace(/^@@/, "@") : node.value.replaceAll("@@", "@");
  return value + node.children.filter(n => n.tag === "CONT" || !modern && n.tag === "CONC")
    .map(n => `${n.tag === "CONT" ? "\n" : ""}${gedcomText(n, modern)}`).join("");
}

// File contents can contain thousands of distinct extensions. Bound UI output
// while counting every omission; never copy source values into diagnostics.
export function importWarnings() {
  const entries = new Map<string, number>();
  let additional = 0;
  return {
    add(message: string) {
      if (entries.has(message)) entries.set(message, entries.get(message)! + 1);
      else if (entries.size < 100) entries.set(message, 1);
      else additional++;
    },
    list() {
      const warnings = [...entries].map(([message, count]) => `${message}${count > 1 ? ` (${count} occurrences)` : ""}`);
      if (additional) warnings.push(`${additional} additional warnings omitted from this preview.`);
      return warnings;
    },
  };
}
