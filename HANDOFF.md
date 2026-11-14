# Live password rejection investigation

- Current task branch: `fix-cloudflare-password-request`. User reports that both shared links reach the login page, but password submission returns "This request must come from the family website." User confirms the address bar shows `jaiamin.com/family-tree`.
- User wants both apex and www links to work and authorizes inspecting and fixing the live Cloudflare configuration. No production changes have been made.
- Verified all four `jaiamin/website` commits affecting `vercel.json`. Both Worker rewrites are unchanged since their creation. Current config exactly equals the October 27 version (`2c2df48`); November 2 added a www-to-apex redirect and November 10 removed it with the stated reason that it looped with Fly's apex redirect. Restoring the redirect is not supported by the evidence.
- GitHub records a successful Cloudflare Workers Build of `6066b11` on November 2, version `1ac4b73f-d9f9-490d-bd41-df2895da8ba5`. This does not establish the currently active deployment or runtime bindings.
- Network access now works. Confirmed live cause: apex GET returns HTTP 308 from Fly to `https://www.jaiamin.com/family-tree`; both links reach the password page. POST from the www origin returns the exact website-origin rejection. The same direct Worker POST using the apex origin passes the origin guard and reaches password validation (tested with an empty password, never the real password). Direct apex POST returns 405, but the browser normally follows the page redirect first and submits from www.
- A read-only OPTIONS probe against `/family-tree/api/login` distinguishes the origin guard without login attempts or data changes: direct Worker with apex Origin returns 401 "Please sign in."; www Origin returns the exact 403. Correct the canonical installation origin to `https://www.jaiamin.com` and keep the Workers Builds installation configuration in sync.
- Cloudflare rejected the first secure credential as "Invalid API Token". A replacement API token has been requested through the secure input tool. Do not record or print credentials. Runtime settings and active deployments cannot yet be inspected through the API.
- Added a deployment smoke check using the OPTIONS probe, regression coverage at all three supported base paths, and operational guidance on redirected origins/build configuration. Tests failed before the change and all four pass on Node 26 afterward. The new smoke check also reproduces the live www deployment failure. Diff whitespace checks and Gitleaks pass.
- Next: obtain a valid token, inspect active Worker settings/deployment, update only the public origin while preserving all other bindings, synchronize the build configuration if permitted, and verify the canonical route reached from both shared links. Preserve secrets, database bindings and stored family data. Do not weaken origin checks.

# Password login origin compatibility

Branch: `fix/password-origin-check`.

- Report: visitors at the family website receive "This request must come from the family website." when entering the shared password.
- Reproduced the exact 403 in both runtimes with a correct synthetic password and a missing Origin header, despite a same-origin Referer. Tests were red before the fix.
- Preserve explicit Origin checks and bearer clients. For missing/opaque Origin, accept browser-controlled Sec-Fetch-Site: same-origin. For missing Origin and Fetch Metadata, accept an exactly matched Referer origin. Foreign/opaque origins without reliable evidence remain rejected.
- The affected visitors' actual request headers are not available. Browser/app clarification requested; network policy blocks production inspection at jaiamin.com and documentation at developer.mozilla.org. No production changes made.
- Verification: Node 26 build, TypeScript checks, all 111 web tests, all 16 browser tests (including header fallback login/session persistence at 320px and 1280px) and secret scan pass.
- Draft PR: https://github.com/jaiamin/family-tree/pull/64. Local verification is complete; inspect required CI on the PR. Owner review/merge/deployment is still required; actual affected-browser confirmation remains outstanding.
- Acceptance: reproduce exact error, support safe header fallbacks, retain password checks and cross-site rejection, verify desktop/mobile login and session persistence, publish a draft PR.

## Previous completed task

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
