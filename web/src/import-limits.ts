export const MAX_GEDCOM_BYTES = 5_000_000;
export const MAX_GEDCOM_LINES = 100_000;
export const MAX_COLLECTION_PEOPLE = 10_000;
// Quotes, backslashes, tabs and line endings can double in a JSON string.
export const MAX_IMPORT_BODY_BYTES = MAX_GEDCOM_BYTES * 2 + 10_000;
