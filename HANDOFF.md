# CI/CD improvements

## Goal and acceptance
- Improve CI latency and diagnostics without dropping meaningful coverage or required checks.
- Research official guidance; audit Cloudflare's existing Git deployment before choosing CD changes.
- Verify Docker, browser base paths, checks, and production dry-run; deliver through PR, never merge.
- Preserve production resources, data, credentials, and unrelated working files.

## Progress
- Baseline: recent full CI ~1m40s; Docker job ~32s (21s test step). Web browser installation ~22s; repeated admin tests at alternate base paths ~24s.
- Required checks: mcp (3.10), mcp (3.14), web, local, secrets.
- PR #60 merged during implementation. Merged latest main into assigned branch; current work is in draft PR #61.
- Implemented PR-only cancellation, timeouts, single Python lint run, focused alternate-path browser runs, failure diagnostics and Docker layer caching.
- Cloudflare production build cache enabled; watch paths narrowed to web/* excluding web/tests/* and web/playwright.config.mjs. No builds triggered or production data modified.
- Added read-only public deployment smoke command and tests; current live URL passes it. Cloudflare deploy command must append `&& pnpm smoke` after merge (script is not on main yet).
- Fixed README Geist license link to official OFL.txt.
- Verified Playwright guidance: install only its headless shell in CI (same browser used by existing tests); avoid full unused Chromium download.

## Decisions and next steps
- Research concurrency, Docker caches, Playwright guidance, and Cloudflare CI integration.
- Keep one full browser suite; evaluate focused base-path contract tests for alternate paths.
- Record measured before/after CI timings; do not promise gains before measuring.

## Verification
- Actionlint, Python formatting/lint/type checks passed.
- Web build, type checks and all 65 Node tests passed.
- Full browser suite: 6 passed, including narrow-screen states. Both alternate paths passed; production dry-run and both Docker invocation paths passed.
- Next: push checkpoint, measure GitHub CI cold/warm cache, review changes, remove task handoff before ready.
