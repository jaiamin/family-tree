# Loading performance

Measured 2026-10-27 against baseline `a0ed317`. These are local lab results, not production Core Web Vitals or a claim about every phone.

## Method

`web/scripts/benchmark.mjs` starts disposable Miniflare D1/R2, seeds a synthetic 256-person binary ancestry tree and 16 tiny PNG avatars, and drives Chromium through CDP. No live data or persistent local family records are read or changed. Five cold/warm navigation pairs use 4x CPU throttling, 100 ms network latency and 1.6 Mbps download at 1280×800. Every navigation starts from a blank document; cold runs clear browser cache. Browser values are medians. UI-ready timings observe DOM/card visibility and decoded selected images, not completion of fade animations. App transfer excludes third-party fonts. Tiny images isolate request latency and understate byte savings for real photos.

API samples use 20 measured local dispatches after one warm-up. They exclude real D1 geography, proxy/network latency and concurrent family traffic. Differences below a millisecond can be noise. Baseline and candidate use the same harness and fixture shape; UUIDs are regenerated. The baseline compiled Worker was captured before implementation in ignored `.preview/performance/baseline-worker.mjs`.

## Browser and payload

| Measurement | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| First visit: graph ready | 3439 ms | 3211 ms | 6.6% |
| First visit: shared-link profile ready | 3912 ms | 3211 ms | 17.9% |
| First visit: selected photo ready | 3659 ms | 3211 ms | 12.2% |
| First visit: click to profile details | 480 ms | 7 ms | 98.5% |
| Repeat visit: graph ready | 3290 ms | 695 ms | 78.9% |
| Repeat visit: shared-link profile ready | 3774 ms | 695 ms | 81.6% |
| Repeat visit: selected photo ready | 3501 ms | 695 ms | 80.2% |
| Repeat visit: click to profile details | 480 ms | 8 ms | 98.4% |
| Tree HTML (uncompressed) | 1,698,639 B | 34,591 B | 98.0% |
| Tree HTML (gzip) | 493,506 B | 7,755 B | 98.4% |
| First visit: app transfer | 522,330 B | 488,739 B | 6.4% |
| Repeat visit: app transfer | 521,744 B | 23,488 B | 95.5% |

## API median / p95

| Endpoint | Before | After |
| --- | ---: | ---: |
| `/api/session` | 1.05 / 1.29 ms | 1.14 / 1.34 ms |
| `/api/view` | 2.11 / 2.30 ms | 1.38 / 1.57 ms |
| `/api/view?tree=TREE` | 2.97 / 3.29 ms | 2.98 / 3.44 ms |
| `/api/photos/PERSON` | 2.59 / 2.77 ms | 1.45 / 2.34 ms |

The tree view now includes current photo pointers in the same D1 batch; its local API time is effectively unchanged while eliminating the later photo-index request. Overview queries read summaries instead of all people and relationships. A photo read needs two SQL statements including session validation (previously eight), with no R2 read or image body for a matching ETag.

Both versions correctly accept one of 12 simultaneous same-revision edits and reject the other 11 with HTTP409. A separate regression overlaps 12 readers with these writes and verifies each response has a consistent revision and photo map. No concurrency mechanism was relaxed.

## Changes and boundaries

- Content-hashed, minified scripts use public immutable browser caching. Authenticated HTML, JSON and errors remain private/no-store; code contains no family records. Hashes change automatically when content changes.
- Session and view fetches overlap; a shared link preloads its current person's photo while the layout engine downloads. Photos are included at initial render, and unchanged avatar images are retained.
- Photo lookups use an indexed join. Private/no-cache responses reauthenticate and check the current pointer before returning304. Replaced, removed and revoked-access cases are tested. All immutable uploads and backup copies remain retained.
- Details appear immediately on selection while the camera still animates. Shared links start at the selected person without an initial glide. Graph layout options and geometry are unchanged.
- No new package, service, database schema, Cloudflare binding or deployment is required. Production settings were inspected read-only; logs/traces and expected bindings are present. First visits still download and execute ELK, so their improvement is modest.

## Reproduce

Requires the project's dependencies and `agent-browser`. From repository root:

```sh
pnpm --dir web build
node web/scripts/benchmark.mjs web/dist/worker.mjs .preview/performance/after.json
```

Optional first argument accepts a previously compiled baseline Worker; second controls the aggregate/sample JSON output. The runner closes its named browser and disposable runtime. Synthetic fixture mutations never reach production.

Verification: 33 web tests (auth/revocation, concurrent edits/reads, photo retention and cache freshness, backup/recovery, GEDCOM, and identical original/minified engine geometry), 88 Python tests, TypeScript, Ruff and ty. Browser QA uses a separate synthetic family for real edit/save, relative creation, photo crop/upload/reload, search, comparison, both orientations and desktop/mobile. Production build and deployment dry run pass; real Google login and physical touch are not repeated. Nothing was deployed.
