# Header and editor sign-in refinement

Status: user approved local review and authorized push. Previous profile/performance work merged in PR29. Preserve this base-branch handoff file.

Completed: only Share and Family menu remain beside graph search; overview has Family menu. Menu groups family actions, theme/GitHub, and editing/sign-out with dividers and no headings. Signed-in identity/photo/email appear inside it.

Mobile: search inputs remain16px to avoid iPhone focus zoom, with14px placeholder; graph controls36px match header buttons. Count shares the title row, saving20px (92px header); desktop remains68px.

Editor sign-in: compact dialog and responsive official Google button, light/dark themes, load retry and observer cleanup. Success uses a green toast after reload; failures use a red toast above the dialog. A denied attempt refreshes the nonce for retry. Authentication and permissions remain server enforced.

Verification:34 web tests and88 Python tests; TypeScript, Ruff lint/format, ty, production Vite build and Cloudflare deployment dry run passed. Browser checked320/390px and desktop, long titles/counts, theme persistence, viewer/editor menus, native Google button, failed loading/retry, responsive button resizing and simulated successful/denied sign-in toasts. Real Google account authentication and physical iPhone Safari focus behavior were not repeated.

No backend, schema, dependency or production-data changes. Local preview runs on0.0.0.0:8000/family-tree/. Disposable QA services/browser sessions closed. Preexisting untracked.impeccable remains uncommitted.

Next: review CI and merge PR when approved. Main merges trigger the existing Cloudflare Workers Build. Do not merge or manually deploy without authorization.
