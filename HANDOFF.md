# GEDCOM imports up to 5 MB

Branch: `feat/gedcom-5mb-imports`.

## Acceptance criteria

- Accept UTF-8 GEDCOM files up to 5,000,000 bytes in the browser and API.
- Bound parser work to 100,000 lines without allocating an unbounded line array.
- Reject imports exceeding the combined 10,000-person capacity during preview.
- Save large collections with bounded database parameters in one atomic, revision-guarded batch; retain uploads and permanent public IDs.
- Cover size/Unicode/line boundaries, large saves, stale revisions and rollback in both storage runtimes; verify desktop/mobile browser flows.
- Run web checks, production build/dry-run and available repository checks; publish a task branch and one draft PR after secret scanning.

## Decisions

- 5 MB means decimal UTF-8 bytes. Keep the existing installation-wide person limit and graph layout.
- Allow a larger JSON envelope only on the owner import routes, accounting for escaping; leave other request limits intact.
- Split database writes into bounded JSON chunks inside a single existing transaction. No schema migration or production access.
- Use synthetic family data only. The container initially provides Node 22; use a project-local Node 26 runtime for verification.

## Progress

- [x] Inspect limits, parser, persistence, browser flow and current Cloudflare documentation.
- [x] Implement safeguards and bounded persistence.
- [x] Add regression coverage and verify browser flows.
- [x] Review, run checks, commit, push and create draft PR.

## Next steps

Draft PR: https://github.com/jaiamin/family-tree/pull/62

Await CI and owner review. No production deployment is authorized. No schema migration or installation setting change is required. Browser sessions and disposable task services have been closed.

## Verification

- Node 26.12.1: build and TypeScript checks passed; 73 web tests passed. Targeted import suite passed again after final revision-order and deletion coverage changes.
- Eight browser tests passed, including desktop/mobile imports and errors. Three installation tests also passed at each of the root and `/our/family` paths.
- Python 3.14: formatting, Ruff, ty and all 96 tests passed.
- Docker smoke passed. Production Vite build and Cloudflare prebuilt deployment dry-run passed with the example installation configuration.
- Exact 5 MB UTF-8/escaped boundaries, 100,000 lines, multi-megabyte saved notes, capacity, stale revisions, bad checksums, chunk rollback and chunked membership deletion are covered in both storage runtimes.
- Gitleaks staged-diff and task-commit scans passed.
- Live Cloudflare CPU/memory quotas were not tested; no production changes or schema migration.
