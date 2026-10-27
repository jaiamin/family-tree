# Admin dialog refinement

Goal: consistent Trees and settings, Editor access, Agent access and Backups; logically grouped family menu; explicit saved/copied states. Preserve graph layout, role enforcement, revision guards and production data.

Implemented: focused create/edit/delete-tree forms; consistent access lists; changes update in place where possible; saved toasts survive required reloads. One-time credentials and backup keys have creation/copy feedback and close protection. Export/import block duplicate submissions and dismissal while saving. Shared dialog/form/toast primitives; no dependencies, API or schema changes.

Verification: web build/type checks, 61 unit tests, six Playwright flows, diff check and Impeccable detector pass. Desktop/mobile, light/dark, narrow layouts, long-list scrolling, save/load failures and clipboard failure checked. Origin main already incorporated.

Local review: synthetic preview on 0.0.0.0:8000/family-tree/, password local-preview-only. A synthetic owner session is seeded; no production data or credentials used. The disposable preview lives under ignored .preview/audit. User requested local testing; UI changes remain unpublished while they review.

Next: incorporate user feedback; before publishing, remove this task-created handoff and update the task PR with final scope and checks. PR58 currently contains only the previous MCP security fix. Preexisting untracked research artifacts are excluded.
