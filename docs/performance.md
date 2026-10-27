# Loading performance

Historical local measurements from 2026-10-27 against `a0ed317`; not current-release timings or production Core Web Vitals.

## Method

The benchmark uses disposable Miniflare, 256 synthetic people and 16 tiny PNGs; no family data. Browser results are medians of five cold/warm pairs: Chromium, 4× CPU throttle, 100 ms latency, 1.6 Mbps, 1280×800. Cold runs clear cache. Readiness measures visible cards/decoded photos, not fade completion; transfer excludes third-party fonts. Tiny photos understate real image-byte savings.

API median/p95 uses 20 local dispatches after warm-up, excluding real network/D1 geography. Submillisecond differences may be noise. Both versions accepted one of 12 same-revision writes and rejected 11 with HTTP 409; concurrency protection was unchanged.

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

## What changed

- Content-hashed scripts cache immutably; authenticated HTML/JSON/errors remain private/no-store.
- Session/view requests overlap. Initial rendering includes photo pointers; deep links preload the selected photo.
- Indexed photo queries reauthenticate before ETag/304 responses; selection shows details immediately.

First visits still download and execute ELK. Layout geometry was unchanged.

## Reproduce

Install project dependencies and `agent-browser`, then run from the repository root:

```sh
pnpm --dir web build
node web/scripts/benchmark.mjs web/dist/worker.mjs .preview/performance/after.json
```

The runner closes its named browser and disposable runtime. Arguments select the compiled Worker and JSON output. The historical baseline artifact is not tracked; reproducing that comparison requires a separately built baseline. Results vary by machine and release.
