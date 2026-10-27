# Performance optimization

Goal: shorten tree/profile loading without changing graph visuals, authorization, concurrency guarantees, or production records.

Acceptance:
- Baseline and final reproducible local browser/API benchmarks, with results and limitations documented.
- Versioned reusable JS assets can be cached; HTML/data stay private and fresh.
- Session/tree/photo discovery overlaps; existing images are not needlessly recreated.
- Photo reads use targeted queries and authenticated private ETag revalidation; removed/replaced photos and revoked sessions never return stale 304s.
- Concurrent edit, authorization, photo retention, backup, frontend flows and required checks pass.

Plan: baseline fixture benchmark; implement asset/loading/photo changes; regression tests and browser flows; compare results; full checks/build and draft PR.

State: baseline worker saved in ignored .preview/performance. Production resources/data unchanged. Assigned branch agent/ux-c8284e07; PR28 was merged. Preserve preexisting .impeccable.

Decisions: no architecture replacement, public family-data cache, schema migration, or production deployment. Benchmark disposable synthetic data only. Cloudflare read-only if available.

Progress: implementation and benchmark complete. Content-hashed minified public scripts; parallel session/view startup; selected-photo preload; photo pointers in snapshot; summary-only overview SQL; indexed photo reads with private authenticated ETags; unchanged images retained; details show during camera animation. Removed obsolete waiting styles/listeners. No dependency, schema or resource changes.

Evidence: docs/performance.md records methodology and complete before/after table. Five cold/warm pairs on 256 synthetic people, Chromium4xCPU/100ms/1.6Mbps. Repeat graph3289.8→694.7ms, profile3774→694.7ms, click480.4→7.7ms; repeat app transfer521744→23488B. First graph3438.6→3211ms (modest). API tree time effectively unchanged while photo-index fetch eliminated. Benchmarks and synthetic QA use disposable Miniflare; normal preview remains8000.

Verification:33 web tests,88 Python tests, TypeScript, Ruff format/lint, ty; production Vite build on Node26 and Cloudflare dry run pass. New tests cover public-code/private-data headers, ETag freshness/revocation/removal, 12 competing edits +12 concurrent readers, and identical engine geometry in both orientations. Browser synthetic QA: real edit/save and relative creation, photo crop/upload/reload, search, compare, both layouts, desktop/mobile/light/dark. No real Google login/physical touch re-test. Cloudflare settings inspected read-only; expected bindings/logs/traces present. No production requests changed data.

Next: user reviews local optimization and comparison before deciding to publish. Keep this work local, no deploy. Tracked handoff is task-created; move into PR summary and remove before eventual PR. Ignored .preview/performance stores baseline compiled code and synthetic benchmark samples; preserve preexisting .impeccable.
