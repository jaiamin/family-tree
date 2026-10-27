# Demo screenshot review

Goal: a balanced fictional 100+ person family demo and real-app screenshots for README review. No production changes or publication.

Complete: isolated demo in ignored .preview/demo; 106 connected people, 35 couples, five generations, two overlapping trees. All people have metadata and photos. Seventeen CC0 Wikimedia source portraits are reused across distant branches, with source metadata and credits retained in .preview/demo/CREDITS.md. Identities and relationships are fictional.

Outputs: .preview/demo/output/family-tree-profile.png (light, profile open); family-tree-compare.png (dark, first-cousin comparison and five-person connection path). Both are 2560×1800 real browser screenshots, framed through supported pan/zoom behavior. Existing application code and README unchanged.

Verified: family chronology (no future births; parents at least 18), one connected graph, schema accepted by real API, all 106 photo pointers populated, all displayed images decoded, no browser errors. Main profile shows metadata and parents/partner/sibling/children; comparison verified first cousins through a shared grandparent. Source credits and licensing remain separate from MIT app code.

Review decision: recommend two images—primary tree/profile, secondary comparison/dark mode. User will review composition before adding assets or README markup.

Local environment: demo runtime runs on port 8004, /family-tree/, password local-preview-only. Previous admin preview on port 8000 is separate. All generated demo artifacts are ignored; preexisting research artifacts untouched.

Next: incorporate user feedback; only move approved screenshots/credits and needed reusable fixture code into tracked locations. Remove this task-created handoff before publishing a PR. Nothing pushed or deployed for this task.
