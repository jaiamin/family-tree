# GEDCOM compatibility upgrade

Branch: `feat/gedcom-compatibility`, based on main after PR #62.

## Acceptance criteria

- Decode original file bytes: UTF-8, BOM/detectable UTF-16 LE/BE, ANSEL and Windows-1252/ANSI. No silent replacement of invalid bytes or encoding guesses.
- Parse GEDCOM 5.5/5.5.1, common 5.5.5 extensions and 7.0 core structures with LF/CRLF/CR, strict framing/IDs and useful line diagnostics.
- Preserve unnamed people using a warning and placeholder, resolve shared NOTE/SNOTE, and retain standard family unions without requiring marriage events.
- Import birth/unspecified parentage; omit explicitly adoptive/foster/other non-birth links with warnings, preserving these distinctions rather than inventing genealogy. No schema changes.
- Preview states detected format and encoding and summarizes imported/omitted information with bounded warnings.
- Keep 5 MB original-file, 100,000-line and 10,000-person limits; preserve owner-only access, checksums, revision checks and atomic saves.
- Test synthetic regressions and public exporter samples including D-Jeffrey and Ancestry. Never commit family data.
- Verify both storage runtimes, desktop/mobile browser flows, required checks, build/dry-run and secret scan; publish one draft PR.

## Decisions and progress

- Previous investigation reproduced encoding, CR line ending, unnamed-person, shared-note and missing-union failures. See ignored `.preview/gedcom-compatibility-report.md` for public sample results.
- Use raw file bytes in the browser/API so legacy text is decoded once on the server. Keep JSON text source support for existing API clients.
- Preserve unsupported optional data only through explicit warnings; lossless GEDCOM archival is outside this task.
- [x] Add failing regression tests (30 failures reproduced before implementation; now 34 parser tests).
- [x] Implement byte decoding and bounded parser/domain mapping, raw-byte API and upload preview.
- [x] Verify public corpus and UI; complete checks.
- [x] Review and local verification, including clean Gitleaks scan.
- [x] Commit and push task branch; draft PR #63 opened.
- [ ] Required CI: monitor the checks on PR #63.

## Next steps

The owner authorized resolving the scanner findings and pushing. Renamed the public ANSEL table constants from KEYS to CODES to describe character codes accurately; mapping values and scanner rules are unchanged. Build, type checks, all 109 web tests and Gitleaks passed after the rename. Implementation is committed and pushed; draft PR: https://github.com/jaiamin/family-tree/pull/63. Monitor required CI there before owner review. No production changes are authorized.

## Verification

- Node 26: build, TypeScript checks, 109 web tests pass, including both Cloudflare/Local raw-byte imports, exact 5 MB boundary, owner permissions, checksum/revision rejection and atomic saves.
- Browser: 12 tests pass at `/family-tree`; 7 installation tests each at root and `/our/family`. Includes 320px/1280px byte uploads, invalid-file recovery and warnings. Manual agent-browser inspection confirmed readable warnings and visible import action at 320px; session/service closed.
- Python: formatting/lint/type checks and all 96 tests pass. Docker smoke passes. Production Vite build and Cloudflare dry-run pass with example configuration (no deployment).
- D-Jeffrey samples: basic (5), Royal92 ANSEL (3,010), Ivar (1,288), Presidents (2,322), Harry Potter ANSI (114) import. Ivar has ambiguous parent sets: 49 parent links omitted with warnings, people retained.
- Queen remains rejected on malformed line 20. Habsburg (9.9 MB, 34,020 records) and Longsword (48 MB, 203,154 records) remain size-rejected; previous independent parser assessment established structural validity, not suitability for app limits.
- Public Ancestry export imports 22 people. Findmypast GoT/MyHeritage (501), Kennedy (70), Simpsons (11), children-only ANSEL and same-sex/unknown-sex unions import. Middle Earth is HTML and remains rejected.
- GEDCOM7code note/encoding fixtures parse but contain zero INDI records, so are correctly rejected by the app’s minimum-person requirement. Synthetic tests verify GEDCOM 7 imports with people.

## Limits and remaining scope

Core import only: sources, citations, media, alternate names and unsupported events/extensions are omitted with bounded warnings. Explicit non-birth and ambiguous >2-parent links are omitted rather than misrepresented. Name/note field limits remain. Retain the original GEDCOM for information outside this model. No public family contents or fixtures are committed.
