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
