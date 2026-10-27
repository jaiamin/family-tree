# UI reliability and mobile refinement

Goal: implement the five agreed critique priorities, plus a single-row mobile home header with visible theme/GitHub controls. Preserve the graph engine and visual identity. Stay on agent/ux-c8284e07; no production data changes or manual deployment.

Acceptance criteria:
- Home header is one row at mobile widths; theme and GitHub remain visible in the header.
- Dirty forms guard dismissal and transitions; modal Escape leaves the person selected; saves show status and preserve viewing context.
- Mobile profiles/comparison retain usable scrolling and comfortable controls; long ancestor wording is compact.
- Relative creation supports explicit other-parent choice atomically; existing-person search supplies identity context; shared edits and partial dates are explained.
- Photo preview supports repositioning/zoom and cancel without altering upload retention/authorization.
- Relationship wording avoids unsupported half-sibling claims, prioritizes direct partners, and explains removed cousins; profile labels agree.
- Meaningful regression tests and desktop/mobile browser flows pass, including short screens, drafts, photo preview, comparisons, and error states.

Plan:
1. Header/mobile and form lifecycle; checkpoint.
2. Relative creation, identity/context and API tests.
3. Photo crop and relationship language/regressions.
4. Browser verification, full checks/build/dry run, local review and task PR.

Progress: all acceptance criteria implemented and verified locally. Baseline origin/main a0164be. Shared header utilities, far-right more menu, left-aligned icon/text rows; mobile tree sharing moves to more menu and home remains one row. Short-screen editor tools adapt to preserve scrolling; mobile canvas tools use a horizontal row. Dirty-dialog guards and exact camera restoration verified (0px position difference). Second-parent atomic API and contextual person picker verified without mutating local family records. Adjustable crop pan/zoom, cancellation, failed-upload preservation and retry verified with intercepted responses. Cautious relationship labels and compact distant-ancestor descriptions implemented in UI; Python half-sibling evidence and spouse precedence agree.

Verification:
- 28 web tests, TypeScript check, 88 Python tests, Ruff format/lint and ty pass.
- Production Vite build and Cloudflare deployment dry run pass; no deployment.
- Impeccable detector clean; git diff whitespace clean.
- Browser checked home/tree headers, menus/account photo/long email at320/390/desktop, light/dark, draft guards/Escape, new-relative second-parent selection, crop cancel/retry, comparison no-results,21-person path and saved camera restoration. Long comparison path has275px scrolling space at390x844 (previous critique78px).
- Real Google login and physical-device touch testing not repeated; authentication/storage rules unchanged.

Next: user reviews local preview at http://localhost:8000/family-tree/ (development password local-preview-only). Keep this task local until requested to push. When publishing, update one PR, remove this task-created handoff in a normal commit, and run CI. Preserve preexisting .impeccable artifacts; no production data was changed.

Decisions: existing center crop remains the default, with user adjustment; other parent must be explicitly selected (no silent assumptions). No new dependencies. Owner/editor permissions and immutable photo storage remain unchanged.

Follow-up: mobile account trigger retains its chevron and 8px side padding. Account photos stay mounted as an overlay above initials; image load no longer reparents the image, avoiding a potential flash. Verified ten repeated toggles each on home and tree: same image node, zero missing-photo samples or DOM replacements. At320px, home stays one row with unclipped title; menu stays in viewport; arrow visible and8px padding. Desktop keeps10px padding and visible arrow. Build, type check and detector pass. Local Google-image flicker was not reproduced before the fix; reparenting on image load was removed as a potential cause.
