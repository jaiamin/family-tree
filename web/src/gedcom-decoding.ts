import { assert, HttpError } from "./model";
import { MAX_GEDCOM_BYTES } from "./import-limits";
import { decodeAnsel } from "./gedcom-ansel";

const sizeMessage = "Choose a GEDCOM file of 5 MB or less.";
const encodingName = (name: string) => name.trim().toUpperCase();
function declaredEncoding(source: string) {
  // CHAR belongs to HEAD; do not search the rest of the document for declarations.
  const headEnd = source.search(/[\r\n]0 /);
  const head = headEnd < 0 ? source : source.slice(0, headEnd);
  return encodingName(/(?:^|[\r\n])1 CHAR ([^\r\n]*)/.exec(head)?.[1] || "");
}
function supported(name: string) {
  return !name || ["UTF-8", "UTF8", "ASCII", "ANSEL", "ANSI", "WINDOWS-1252", "CP1252", "UNICODE", "UTF-16", "UTF-16LE", "UTF-16BE"].includes(name);
}
function decode(bytes: Uint8Array, encoding: string) {
  try { return new TextDecoder(encoding, { fatal: true, ignoreBOM: false }).decode(bytes); }
  catch { throw new HttpError(400, `Invalid ${encoding.toUpperCase()} text. Export this GEDCOM using UTF-8.`); }
}
export function decodeGedcom(input: string | Uint8Array) {
  const textInput = typeof input === "string";
  assert(!textInput || input.length <= MAX_GEDCOM_BYTES, sizeMessage, 413);
  const bytes = textInput ? new TextEncoder().encode(input) : input;
  assert(bytes.byteLength <= MAX_GEDCOM_BYTES, sizeMessage, 413);
  let source: string, encoding = "UTF-8";
  if (textInput) source = input;
  else {
    const utf16le = bytes[0] === 0xff && bytes[1] === 0xfe || bytes[0] === 0x30 && bytes[1] === 0 && bytes[2] === 0x20 && bytes[3] === 0;
    const utf16be = bytes[0] === 0xfe && bytes[1] === 0xff || bytes[0] === 0 && bytes[1] === 0x30 && bytes[2] === 0 && bytes[3] === 0x20;
    const bom8 = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    if (utf16le || utf16be) {
      encoding = utf16le ? "UTF-16LE" : "UTF-16BE";
      source = decode(bytes, encoding.toLowerCase());
    } else {
      // ASCII framing is common to all supported 8-bit encodings. Inspect only
      // a bounded header before selecting the decoder; never guess from names.
      const peek = new TextDecoder("windows-1252").decode(bytes.subarray(0, 64_000));
      const declaration = declaredEncoding(peek);
      assert(supported(declaration), `Unsupported GEDCOM encoding: ${declaration.slice(0, 40)}. Export as UTF-8.`);
      assert(!["UNICODE", "UTF-16", "UTF-16LE", "UTF-16BE"].includes(declaration), "The UTF-16 declaration does not match the file bytes. Export as UTF-8.");
      assert(!bom8 || !declaration || ["UTF-8", "UTF8"].includes(declaration), "The character encoding declaration conflicts with the UTF-8 BOM.");
      if (declaration === "ANSEL" && !bom8) { source = decodeAnsel(bytes); encoding = "ANSEL"; }
      else if (["ANSI", "WINDOWS-1252", "CP1252"].includes(declaration) && !bom8) {
        source = decode(bytes, "windows-1252"); encoding = "Windows-1252";
      } else {
        source = decode(bytes, "utf-8");
        if (declaration === "ASCII") assert(bytes.every(byte => byte < 128), "Non-ASCII bytes in an ASCII GEDCOM. Export as UTF-8.");
      }
    }
  }
  const declared = declaredEncoding(source);
  assert(supported(declared), "Unsupported GEDCOM encoding. Export as UTF-8.");
  if (!textInput) {
    const expected = declared === "ANSEL" ? "ANSEL" : ["ANSI", "WINDOWS-1252", "CP1252"].includes(declared) ? "Windows-1252" : ["UTF-8", "UTF8", "ASCII"].includes(declared) ? "UTF-8" : "";
    assert(!expected || encoding === expected, "The encoding declaration conflicts with the file bytes or appears too late in the header. Export as UTF-8.");
    if (declared === "ASCII") assert(bytes.every(byte => byte < 128), "Non-ASCII bytes in an ASCII GEDCOM. Export as UTF-8.");
    assert(!["UNICODE", "UTF-16", "UTF-16LE", "UTF-16BE"].includes(declared) || encoding.startsWith("UTF-16"), "The UTF-16 declaration does not match the file bytes. Export as UTF-8.");
  }
  if (!textInput && encoding.startsWith("UTF-16")) {
    assert(!declared || ["UNICODE", "UTF-16", encoding].includes(declared), "The character encoding declaration conflicts with the UTF-16 file bytes.");
  }
  assert(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(source), "Choose a GEDCOM file containing plain UTF-8 text or a supported legacy encoding.");
  return { source, bytes, encoding, declared, textInput };
}

export function gedcomBytes(encoded: unknown): Uint8Array {
  assert(typeof encoded === "string", "Invalid GEDCOM file encoding. Choose the file again.");
  assert(encoded.length <= Math.ceil(MAX_GEDCOM_BYTES / 3) * 4, sizeMessage, 413);
  assert(encoded.length % 4 === 0 && !/[^A-Za-z0-9+/=]/.test(encoded), "Invalid GEDCOM file encoding. Choose the file again.");
  let binary: string;
  try { binary = atob(encoded); } catch { throw new HttpError(400, "Invalid GEDCOM file encoding. Choose the file again."); }
  assert(binary.length <= MAX_GEDCOM_BYTES, sizeMessage, 413);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
