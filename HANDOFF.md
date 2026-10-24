# Shared collection and multi-tree website

## Goal and acceptance
- A site has its own configurable name/project and always opens a tree chooser.
- UUID people are stored once; UUID trees select people, shared relationships stay global.
- MCP supports discovery across the collection and adding existing people to trees.
- All publishing rebuilds the complete site; stable tree URLs survive renames.
- No legacy runtime or family-specific defaults. Existing files remain untouched.
- Preserve graph interaction; verify desktop/mobile, privacy, shared edits, undo and publishing.
- Provide a compact reconstruction prompt containing the public graph's names/sex/links.

## Decisions
- One atomic collection.json, collection-wide undo, explicit memberships.
- Removing membership does not delete a person or their relationships.
- New store refuses legacy tree files with actionable guidance; no automatic fallback.
- Site configuration is required before publishing; no name derived from a tree.

## Progress
- Inspected current model, persistence, publisher, viewer and tests; fetched main.
- Shared collection, transactional projections, UUID identities, global undo and membership tools implemented.
- Site-wide publisher/export, chooser, stable routes, shared header and tree dropdown implemented.
- Existing 64-person public graph is in ignored local preview; Amin Family intentionally empty.
- User revised chooser: viewer-style header, unique total, family cards/stats, GitHub/theme; implemented.
- 103 tests passing, including existing graph geometry/kinship plus new shared-data tests.
- Ruff/type checks, JS syntax, wheel and sdist builds pass; wheel assets checked.
- Desktop/mobile light/dark chooser and breadcrumb verified in browser, no horizontal overflow.
- Dropdown opens below, lists only trees, closes outside without mouse outline; keyboard switching and tree reset verified.
- Reconstruction prompt in ignored .preview/recreate-tree.txt verified against all 64 names/sexes, 87 parent edges and 19 partnerships.
- Fetched/merged origin/main; already current.

## Verification / next action
- Commit and publish task branch with draft PR; keep preview service running on 8000.
- Preview port 8000; do not publish the user's family data from this sandbox.
