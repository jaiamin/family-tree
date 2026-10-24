# Family graph viewer rewrite

## Agreed goal
KISS: one continuous, connected graph; one card per person; partners in vertical pairs;
all records visible by default; same desktop layout on mobile, navigated by pan/zoom.
Keep search, person details, zoom and Show everyone. No dropdowns, collapse controls,
reference duplicates, responsive graph rearrangement, or special-case family names.

## Acceptance criteria
- Divya and Shashank each appear once, in one vertical pair, with both ancestry inputs and
  their shared child junction connected correctly.
- Generations progress top to bottom; couples have a short vertical connector.
- No card overlaps or lines through cards.
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

## Previous top-to-bottom verification
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

## Earlier cleanup
- Removed relationship captions from mini cards and deleted their layout metadata.
  Names/dates remain; relationship details stay in the details panel.
- No centering postprocessor or experimental layout setting remains.
- Viewer tests: 9 passed; Ruff passed; browser confirms 64 cards with no Spouse captions.
- Both local previews refreshed. No publication.

## Next action
User reviews local rendering before any publication. Existing draft PR #14 still has the
older patch. Do not push/deploy until user authorizes publication. Future arbitrary nonplanar
graphs can require crossings; current zero-crossing verification applies to this tree.

## Left-to-right revision (complete)
- User approved replacing the previous direction using the same ELK engine.
- Couples become vertical pairs; individual ancestry enters from the left and shared
  children leave the couple junction to the right. No alternate mode or routing engine.
- Actual tree: 64 unique cards, 1196 × 2260 (previously 5500 × 596); no card
  intersections or unrelated wire crossings; all child paths reach actual parents.
- Desktop/mobile geometry identical. Search, details, partner navigation and zoom/fit
  checked in browser. Both local preview URLs refreshed on port 8000.
- All 95 tests, Ruff, ty, wheel and sdist pass; detector reports no findings.
- Revision committed locally only; user review before push/deployment.

## Compact top-to-bottom revision (complete)
- User selected top-to-bottom generations with vertical couples using existing ELK.
- Keep individual ancestry inputs on the left; shared output descends through a small
  reserved right gutter beside the lower partner, preventing card intersections.
- Added short boundary connections for children recorded under only one partnered
  parent; multiple-union junctions leave downward to preserve clear routing.
- Actual tree is 5299 × 824, 64 unique cards, no card intersections or unrelated
  crossings. Parent-path topology checks pass. Proportions improve only moderately
  over original 5500 × 596; no claim of a laptop-ratio result.
- All 95 tests, formatting/lint, ty, wheel/sdist builds pass. Browser search/details,
  desktop/mobile geometry and zoom/fit checked; detector reports no findings.
- Both preview URLs refreshed; port 8000 remains available. Local-only revision.

## Immediate-family selection (complete)
- Selection frames the person, partners, parents and direct children; excludes distant
  ancestors. Highlighting also stops at parents; siblings remain visible as close family.
- Card/search/relative-link selection all preserve the view when the family fits.
  Reframing retains current zoom when possible, with the existing readable 60% floor.
- Removed unused ancestor traversal and forced-reframing argument. Graph layout unchanged.
- Browser: Shashank selection excludes grandparent Hari; reselecting preserves camera;
  resize preserves camera; mobile Nirav sheet and immediate-family highlighting checked.
- All 95 tests, Ruff, ty and JS syntax check pass; detector has no findings.
- Local previews updated on port 8000; no push/deployment.

## Details sidebar and search hover (complete)
- Desktop uses a 320px sidebar beside a clipped canvas; framing reads actual canvas
  dimensions instead of estimating free space. Removed floating-panel placement code.
- Mobile starts with a 38dvh sheet (max 320px), expandable to 70dvh. Name/close/expand
  controls stay fixed while details scroll. Canvas and zoom remain above the sheet.
- Search hover and arrow keys share one active-result helper; Enter opens the hovered
  result. Active option is also linked through aria-activedescendant.
- Browser assertions: sidebar/canvas don't overlap; collapsed and expanded sheets do
  not cover zoom; zoom/fit work with details open; hovering Divya then Enter selects Divya.
- All 95 tests, Ruff, ty, JS syntax and wheel build pass; detector has no findings.
- Both local preview URLs refreshed. No push/deployment.

## Mobile people count
- Removed mobile-only count hiding rule; same people count appears on desktop/mobile.
- Browser checked count visibility and no page overflow at 390px and 320px widths.
- Both local previews refreshed; no publication.
