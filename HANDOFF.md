# List view and loading skeletons

Goal: add a simple alphabetical List as the third tree view, preserving the graph and existing profile. User approved local testing and authorized pushing for review. Do not merge or manually deploy.

Acceptance: Top-down / Left-to-right / List are mutually exclusive and remembered; list shows photos, names and known years for the selected tree; header search filters directly; rows open the existing profile and all its actions; zoom is hidden in List; desktop sidebar and mobile bottom sheet remain unchanged; native list scrolling works.

Implemented: frontend-only extension in share.html/share.js using existing tokens, avatars, profiles and view controls. Keeps the last graph direction separately from List preference. Graph engine and backend are unchanged. List uses native buttons and scroll, readable desktop width and full mobile width. Photos repaint through the existing shared avatar mechanism.

Verification complete: build, TypeScript, all 34 web tests and 88 Python tests passed; git diff --check clean. Browser verified desktop/mobile/dark rendering, native scrolling, search/empty results, Enter selection, comparison, List persistence, return to graph, and photo replacement while a person's row is filtered out. Real local Patel tree shows all64 people with no horizontal page overflow at320px. Independent Impeccable reviewer scored both required fixes resolved and returned ship; incumbent design system remains unchanged.

Additional user request: replace loading placeholders with fitted skeletons. Shared static skeletons now cover initial header/login names/count, header menu slot, Google sign-in button, suggestions, editor list, relative form and photo loading. They inherit text line boxes and existing control/avatar dimensions. Unknown text lengths and collection counts cannot be predetermined; skeleton widths indicate text slots, not exact future string widths. Existing names, initials for people without photos, inputs, errors and empty-state copy remain real content. Suggestion filters stay disabled until loading settles; photo errors restore initials. No new dependency or animation.

Local preview: http://localhost:8000/family-tree/ (development password: local-preview-only), bound to 0.0.0.0. Disposable synthetic QA and named browser sessions are closed after verification. Preexisting .impeccable/ is untracked and must remain uncommitted. This HANDOFF.md predates the task and must be preserved.

Next: review and merge the PR. Main merges use the existing Cloudflare deployment pipeline. Port8000 remains available for local review. No production data changes or manual deployment.

## Tree dropdown experiment (local only)

User approved trying people counts and a current-tree checkmark. Rows now use the existing SVG icon style, aligned names, muted tabular counts,44px minimum height and existing current-page semantics. Screen readers get person/people labels. Counts reuse the overview response; no extra request or backend change.

Build, TypeScript and diff checks passed. Browser verified desktop/light and320px mobile, dark rendering and switching trees updates the current selection. Port8000 serves this experiment. Do not push until user approves it.

Dropdown hover follow-up: current tree is indicated only by its checkmark. Gray background now follows hover/keyboard focus rather than persisting on the current row. Browser computed styles confirmed the current row is transparent and the hovered alternative uses the chip surface. Build/type checks passed. Local only.

Editor identity follow-up: reduced name/email separation from4px to1px. Build/type checks passed; browser confirmed1px computed margin with a synthetic editor session response (no account or auth changes). Local only.

Landing review: independent Impeccable design/evidence assessments inspected password entry and overview in desktop/mobile light/dark. Existing minimal layout is sound; no redesign warranted. Recommend plain network-error wording and explicit destination labels for theme toggle. Larger utility targets were noted but are intentionally consistent with user-approved36px controls. No landing redesign applied. No production data mutations.

Landing copy improvements (user approved, local only): shared API fetch failures now say "Couldn't connect. Please try again." while server-supplied validation messages remain intact. Theme menu names its destination, Use dark mode / Use light mode, and updates after toggling. Browser verified simulated network failure, successful retry, both toggles and persistence across reload. Build, TypeScript and34 web tests pass. Port8000 updated; no push/deploy.

Publication: user has now authorized pushing all dropdown, editor spacing and landing-copy changes. Earlier local-only restrictions are superseded for these changes. Open a PR for review; do not merge or manually deploy. Untracked .impeccable/ review artifacts remain excluded.

# Short URL migration — active

Goal: canonical /family-tree/t/<12-character short ID>#<person short ID>, no legacy browser routes. Preserve all current trees, UUIDs, relationships, memberships and immutable photos. User explicitly authorizes migration; do not merge main or delete data.

Acceptance: permanent cryptographically generated IDs with database uniqueness/collision retry; tree/person links everywhere use short IDs; internal UUID APIs/MCP/photo keys remain stable; short person selection validated within selected tree; password entry preserves deep link; backups/restores preserve IDs; concurrent updates safe; old browser URL format rejected. All existing/new records get mappings. No dependencies.

Plan: (1) implement schema migration + transactional ID assignment and backup/recovery integration; (2) migrate browser links/routes; (3) test seeded migration, collision/concurrency, permission/deep-link/recovery and browser desktop/mobile; (4) inspect production counts, apply additive migration safely, publish task PR with deployment instructions and verify what is possible before merge.

Decisions: UUIDs remain the internal identity, as approved in the design. Short IDs are public identifiers, never authentication credentials. No legacy URL alias/redirect support. Production source data must never be replaced by local preview data.


Short URL milestone: production additive migration applied through Cloudflare MCP. Assigned163 permanent IDs (161 people,2 trees); no missing mappings. SHA-256 comparison of collections/people/trees/parents/partnerships/memberships/photos/uploads/suggestions/editors matched before and after. No family records or R2 objects were written. Counts:182 parent links,21 partnerships,165 memberships,2 photo pointers and2 retained uploads.

Implementation: public_ids mapping table, immutable IDs, deletion cleanup and backup-generation triggers; allocation uses Web Crypto Base58 and database uniqueness, retries collisions, commits new IDs in the existing revision-guarded batch. One JSON bulk insert keeps D1 query counts bounded. Collection/MCP and photo UUID identities remain unchanged. Canonical browser/share/cross-tree/suggestion/GEDCOM links use short IDs only. Old tree UUID routes404; old UUID fragments do not resolve. No legacy router or backup reader.

Verification:40 web tests,88 Python tests, TypeScript, Ruff lint/format, ty, Vite production build, deployment dry run and diff check pass. New tests exercise populated-db migration, idempotence, generated/database collisions, immutable IDs, shared people, concurrent writes/no orphan mappings, route authentication and backup restoration retaining IDs. Backup format2 replaces format1 even if the previous generation was already marked saved.

Browser: password-preserved person deep link, shared person across trees, List reload, generated Share links, GEDCOM URL/download, desktop/mobile rendering and rejection of UUID fragments verified. Local record+photo-pointer digest also matched exactly across migration. Port8000 updated; named browser closed.

Remaining rollout: code requires PR merge/deployment (no merge/manual deployment authorized). Production currently still serves its previous URL format. New code upgrades the rolling backup to format2 on its next scheduled backup, within15minutes. If old deployment adds people before rollout, rerun the idempotent ID backfill before deploy; do not import local data. Verify live new URLs and backup after rollout. Untracked .impeccable/ remains excluded. Keep this pre-existing handoff file.
