# Family graph viewer rewrite

## Agreed goal
KISS: one continuous, connected graph; one card per person; partners side by side;
all records visible by default; same desktop layout on mobile, navigated by pan/zoom.
Keep search, person details, zoom and Show everyone. No dropdowns, collapse controls,
reference duplicates, responsive graph rearrangement, or special-case family names.

## Acceptance criteria
- Divya and Shashank each appear once, side by side, with both ancestry inputs and
  their shared child junction connected correctly.
- No vertically stacked person cards, card overlaps, or lines through cards.
- All actual relationships are retained. The user's connected tree stays connected.
- Shared child buses are drawn once. No unrelated crossings in the user's tree.
- Readable initial zoom, stable geometry on resize/mobile; Show everyone fits the graph.
- Relevant tests, lint/types, package build and desktop/mobile browser flows pass.
- Local review on port 8000 before any publication. Do not push this revision yet.

## Decisions
- Use ELK.js for automatic orthogonal layout, locally embedded in exported pages.
  No CDN or external service receives family data. Pin and retain its license/source.
- Group exclusive pairs as one layout block; other unions use distinct junctions.
  Parenting always follows the actual parent set; partners do not imply parenthood.
- Keep layout/model code separate from DOM rendering and the HTML/CSS template.
- Arbitrary future graphs may require crossings; do not misrepresent them as junctions.

## Progress
- Rewrite complete: layout/model, DOM interactions, and HTML/CSS separated.
- ELK.js 0.12.0 embedded with source attribution and license; no remote layout service.
- Both preview URLs contain the same current public-tree copy (64 unique people).
- Desktop/mobile geometry identical. Divya/Shashank side by side; actual-tree geometry
  has no lines through cards or unrelated crossings. Parent-path connectivity checked.
- Browser: search, partner navigation, details, zoom, Show everyone verified. Fixed mobile
  sheet positioning when resizing from desktop. Browser session closed; HTTP service remains.
- Ruff, ty, all 95 tests pass. Wheel and sdist build; all JS/HTML/license assets included.
- `uv build` combined archive extraction failed in this environment; `uv build --wheel`
  and direct `uv_build.build_sdist` via `uv run --with uv_build` both succeed.
- Impeccable mechanical detector: no findings. No push/deployment of this rewrite.

## Local setup and review
- Server: `uv run python -m http.server 8000 --bind 0.0.0.0 --directory .preview`
- URLs: http://localhost:8000/ and http://localhost:8000/candidate.html
- Forward host port 8000 to sandbox port 8000.
- Preview data is disposable and excluded from commits. Source copy: public deployed tree.

## Next action
User reviews local rendering before any publication. Existing draft PR #14 still has the
older patch. Do not push/deploy until user authorizes publication. Future arbitrary nonplanar
graphs can require crossings; current zero-crossing verification applies to this tree.
