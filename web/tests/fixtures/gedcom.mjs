// Synthetic input only; never use family data in tests.
export function syntheticGedcom(count = 1, notes = "") {
  return "0 HEAD\n1 CHAR UTF-8\n" + Array.from({length:count}, (_, i) =>
    `0 @I${i+1}@ INDI\n1 NAME Imported ${i+1}\n${notes ? `1 NOTE ${notes}\n` : ""}`
  ).join("") + "0 TRLR\n";
}

export function sizedGedcom(bytes, character = "x") {
  const source = syntheticGedcom().replace("0 TRLR", "0 _PADDING \n0 TRLR");
  const remaining = bytes - Buffer.byteLength(source);
  const width = Buffer.byteLength(character);
  return source.replace("0 _PADDING ", `0 _PADDING ${character.repeat(Math.floor(remaining / width))}${"x".repeat(remaining % width)}`);
}
