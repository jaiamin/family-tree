# Expanded profile refinement

Goal: clean, stable profile on desktop/mobile for viewers and editors. Preserve graph, performance changes, permissions and photo retention.

Acceptance: photo editing uses the shared dialog instead of replacing profile content; header/details/footer remain in place; consistent content gutters; only metadata/relations scroll; compact fixed footer; editor actions remain outside scroll; mobile expand/collapse and comparison remain usable; light/dark and short-screen states verified.

Plan: reuse shared dialog for photos; simplify profile composition/styles; browser verify viewer/editor/photo success/cancel/error and mobile/desktop/long content; run relevant checks; keep local for review.

Decisions: no dependency, backend or data changes. Reuse existing native dialog lifecycle and cropper. Preserve profile while uploading; enforce existing viewer/editor photo permissions. PR29 contains performance changes; do not push additional UI work until reviewed.

Complete locally: shared Profile photo dialog with existing cropper, dirty-dismiss guards, busy protection, retained crop on failure and retry. The underlying profile is never rebuilt by photo editing. Name/photo header, metadata/relations and single-row Compare/Share/Suggest footer use consistent20px gutters. Metadata values align with the name; relative section labels align with metadata labels. Editor actions are secondary side-by-side buttons outside the scroll; viewers have none. Mobile sheet has consistent collapsed/expanded sizes for both roles. Removed inline photo panel and its layout-hiding CSS.

Verification:33 web tests,88 Python tests, TypeScript, production build and deployment dry run pass; Impeccable detector and whitespace clean. Browser checked1280/390/320×568, light/dark, viewer-only restrictions, long name/notes and many relatives, fixed header/footer while content scrolls, expansion, comparison and crop dialog. Synthetic upload failed via network interception, retained its crop, then succeeded on retry; cancellation kept the same profile node. Current name/metadata alignment measured0px difference. No production data/photos changed. Real Google auth and physical touch not retested.

Next: review at http://localhost:8000/family-tree/. Keep UI changes local until asked to push. Performance PR29 remains separate on remote; local UI commit follows it on the assigned branch. Preserve preexisting .impeccable.

## Dialog refinement

Completed locally: reviewed Edit details, Add relative, suggestions, editor access, deletion, photo and comparison surfaces. Shared dialogs now have compact aligned headers, consistent20px gutters,44px form/footer controls and clearer primary action hierarchy. Selected people retain field labels; connection actions stay readable beside long names. Existing dirty/busy guards, native focus lifecycle, permissions and date flexibility are preserved. No backend or production data changes.

Verification: browser screenshots reviewed at desktop1280, mobile390 and dark320×568; edit/add new-person/other-parent, suggestion, empty inbox, access list, delete confirmation, photo and comparison inspected.33 web tests and TypeScript pass; build, whitespace and Impeccable detector pass. Real Google sign-in and physical device keyboard not retested. Keep local for user review on8000; do not push.

Editor access follow-up: separated the email form from existing editors with dedicated section spacing, removed redundant list borders, and focus the email field after loading. Verified desktop and320px mobile rendering; TypeScript/build/whitespace pass. Local only.

Suggestions follow-up: New/Reviewed/All filters with counts stay fixed above the scrolling list; clearer message/sender/contact/date layout, review/reopen actions, confirmed editor-only deletion and cross-tree Open person links. Removed Done footer. Added DELETE API with existing role/origin/backup guards and regression coverage. Browser verified review/filter/delete,320px light/dark, long-message scrolling and overview-to-person navigation on disposable data only.34 web tests, type checks, generated build and Impeccable detector pass. Owner line simplified; profile text group nudged down2px; compare name padding increased8px. Keep local on8000.
