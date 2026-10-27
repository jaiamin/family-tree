## Problem Statement

Families cannot currently install and privately operate this application without adapting a personal Cloudflare deployment. Configuration contains installation-specific values, local hosting is development-only, tree/account setup is incomplete in the browser, and access depends on a shared viewing password or Google. A family needs ownership of its data, simple sharing with relatives, dependable recovery, and a supported upgrade path without operating a large platform.

## Solution

Provide one private family-tree application with two explicitly selected production deployments: an independent Cloudflare installation and an independently hosted local server packaged with Docker Compose. Each installation owns one collection of shared people and relationships, organized into multiple trees. Relatives use ordinary browser links and invited accounts with installation-wide owner/editor/viewer roles. Local core operation works offline after setup; remote access uses HTTPS.

Preserve the existing viewer and genealogy model. Add neutral configuration, browser onboarding, account/tree administration, GEDCOM preview/import, portable recovery, and explicit migrations. Converge on one current application model rather than maintaining old authentication or compatibility modes.

## User Stories

1. As an installer, I want neutral configuration, so that I can deploy without editing another family's account IDs, domain, branding or personal settings.
2. As an installer, I want my own Cloudflare installation, so that my data and resources remain independent from other families.
3. As an installer, I want a Docker Compose production deployment, so that I can run the application on my own computer or server.
4. As an installer, I want persistent local storage, so that container replacement and restart do not erase family work.
5. As an installer, I want concise setup and upgrade instructions, so that maintaining the application requires modest technical experience.
6. As an installer, I want explicit origin, base-path and HTTPS configuration, so that root and subpath deployments behave consistently.
7. As an installer, I want a documented remote HTTPS endpoint, so that relatives need no VPN or special application.
8. As a local owner, I want core viewing, editing, uploads and administration to work offline after setup, so that my family does not depend on a cloud account or Google availability.
9. As an installer, I want fresh setup to contain no sample family data or personal access grants, so that the installation is genuinely my own.
10. As an owner, I want protected one-time setup, so that a stranger cannot claim ownership by visiting first.
11. As an owner, I want to create the first tree and first person in the browser, so that I do not need MCP to begin.
12. As an owner, I want to name the installation and manage its settings, so that relatives recognize their family website.
13. As an owner, I want to create, rename and delete tree groupings, so that I can organize the collection.
14. As an owner, I want deleting a tree to preserve its people and uploads, so that shared family information is not accidentally destroyed.
15. As an editor, I want to find and reuse existing people, including those outside every tree, so that organizing trees does not create duplicates or strand records.
16. As a relative, I want a person appearing in multiple trees to retain one identity and photo history, so that corrections apply consistently.
17. As an owner, I want to invite named users through expiring single-use links, so that access does not require public signup or an email server.
18. As an invited relative, I want to choose my username and password, so that my access works independently of Google.
19. As an owner, I want to assign viewer or editor access, so that responsibilities are clear.
20. As an owner, I want individual account revocation, so that removing one person's access does not affect everyone else.
21. As a user, I want my installation-wide access scope explained, so that I understand all its trees are visible to me.
22. As a user, I want my login account separate from genealogical people, so that a family profile does not require an account.
23. As an approved user, I want optional explicit Google linking, so that I can use Google without creating a parallel access policy.
24. As an owner, I want to reset a relative's access without email delivery, so that recovery also works offline.
25. As an owner, I want a saved recovery code and host-side recovery command, so that losing credentials does not mean losing family data.
26. As an owner, I want explicit ownership transfer with last-owner protection, so that the installation cannot be left without an administrator.
27. As a viewer, I want the existing graph orientations, List, search, profiles and comparison, so that the current browsing experience is preserved.
28. As a mobile relative, I want readable controls and the existing bottom-sheet behavior, so that viewing and contributing remain straightforward.
29. As a viewer, I want tree/person share links that preserve their destination through sign-in, so that shared references open the intended place.
30. As an owner, I want share links to require authorization, so that forwarding a URL does not grant access.
31. As a viewer, I want to submit general or person-specific suggestions, so that I can help without editing genealogy.
32. As a viewer, I want to add or replace a person's photo, so that relatives can contribute pictures easily.
33. As a viewer, I want previous accepted uploads retained, so that replacing a picture does not lose it.
34. As an editor, I want to edit details and add/connect relatives, so that routine genealogy changes happen in the browser.
35. As an editor, I want to review suggestions, so that contributions can be incorporated or dismissed.
36. As an editor, I want to remove a displayed photo without deleting retained uploads, so that mistakes can be corrected safely.
37. As an owner, I want permanent person deletion restricted to me and explicitly confirmed, so that editors cannot accidentally remove someone everywhere.
38. As an editor, I want a conflicting save explained before overwriting another edit, so that concurrent contributions remain safe.
39. As an owner, I want a concise activity history, so that I can see who performed edits, imports, deletions and access changes.
40. As a user, I want GEDCOM export scoped to the selected tree, so that I can take my genealogy elsewhere.
41. As an owner, I want GEDCOM import preview and validation, so that I understand what will be created before saving.
42. As an importer, I want unsupported fields and unresolved relationships reported, so that information is not silently discarded.
43. As an importer, I want confirmed import into a new tree without automatic name matching, so that unrelated people are not merged.
44. As an owner, I want failed imports to leave no partial changes, so that my collection remains consistent.
45. As an installer, I want complete portable recovery separate from GEDCOM, so that accounts, settings, public IDs and photos can move with the installation.
46. As an owner, I want the latest backup plus seven daily recovery points, so that I can recover after discovering an accidental deletion.
47. As a local installer, I want a configurable second backup path, so that I can use an external drive or mounted network destination offline.
48. As an owner, I want backup freshness and failures visible, so that I do not mistake a configured job for successful protection.
49. As an installer, I want encrypted off-device exports and a separately retained recovery key, so that a copied backup does not expose private information.
50. As an installer, I want verified restore into fresh storage, so that I know records and retained photos are recoverable.
51. As an installer, I want upgrades explicitly initiated with a verified pre-upgrade backup, so that releases do not silently endanger data.
52. As an installer, I want the most recent verified pre-upgrade snapshot retained until the next upgrade's backup is verified, so that protection is bounded and predictable.
53. As an installer, I want incompatible schemas and unavailable storage to fail clearly, so that the application never silently opens an empty alternative database.
54. As the current owner, I want a one-time migration preserving records, relationships, memberships, UUIDs, public IDs and retained uploads, so that adopting the new design does not erase family effort.
55. As an approved existing editor, I want secure account establishment and fresh sign-in, so that my approved access survives without trusting an old email as a Google identity.
56. As an owner, I want shared-password viewing retired after secure account setup, so that the installation has one current access model.
57. As an owner using MCP, I want automation to use the same authoritative application rules, so that agent changes cannot bypass permissions or concurrency safeguards.
58. As an owner, I want automation credentials identifiable and revocable, so that I can control agent access without sharing browser credentials.
59. As a maintainer, I want both deployments checked against the same behavioral contracts, so that fixes do not work on only one hosting target.
60. As a maintainer, I want explicit frontend modules and browser type checking, so that future features do not accumulate in implicit shared scope.

## Implementation Decisions

- The installation is the privacy scope. One collection contains shared people, relationships and named tree memberships. Do not introduce multi-tenant infrastructure or per-tree authorization.
- Preserve person UUIDs, permanent public IDs, existing relationships, memberships, graph geometry rules, search, comparison, List and profile behavior. Public IDs and share links locate records; they never grant authority.
- Keep login users distinct from people. Introduce a coherent account model covering installation role, password credentials, optional provider identities, invitations, revocable sessions, recovery and minimal activity attribution.
- Use one owner, with explicit transfer and protection against removing the last owner. Owner alone manages accounts/settings/tree groupings and permanently deletes people. Editors manage genealogy, suggestions and displayed-photo removal. Viewers may suggest and add/replace photos. All authorized users may view/export authorized tree data.
- Account and tree permissions apply installation-wide. Changes to a shared person or current photo propagate wherever the person appears. Tree deletion removes the grouping/memberships, not shared genealogy or retained uploads.
- Bootstrap requires an installer-generated single-use claim credential consumed atomically. No public first-visitor ownership or public registration.
- Invitations are expiring and single-use; owners share them themselves. Local username/password authentication and owner-mediated reset require neither SMTP nor external identity services. Protect invitation/recovery secrets from application logs and third-party requests.
- Optional Google identities are explicitly linked to approved accounts using stable provider/subject identity. Email is not a permanent provider identifier and must not trigger automatic account merging.
- Use audited adaptive password hashing. Select the implementation and cost only after verifying runtime support and performance on both deployments. Preserve secure opaque sessions, per-request authorization, revocation, CSRF/origin defenses, rate limits and explicit trusted proxy handling.
- Saved owner recovery codes and operator recovery restore access without resetting genealogy. Recovery invalidates affected sessions. Store credential verifiers, not plaintext passwords or recovery secrets.
- Support two explicit implementations: Cloudflare Worker/D1/private R2 and a real long-running local server with same-machine SQLite/private filesystem storage. Docker Compose is the recommended local packaging. The development simulator is not the production runtime.
- Expose narrow application-facing interfaces for transactions, private uploads, scheduled work and trusted request context. Share domain/application operations across HTTP/browser/MCP. Do not recreate the entire D1/R2 interface or build a general plugin framework.
- Select the local runtime and SQLite driver through a small compatibility prototype. Keep the live SQLite database on the server's local filesystem; network backup destinations are a different concern.
- Local core operation must work without internet after setup. Bundle required fonts and assets. Google and remote tunnels are optional conveniences, never mandatory offline dependencies.
- Remote local hosting needs an always-on machine and a maintained HTTPS endpoint. Document a reverse proxy or optional tunnel without mandating a cloud account for local/LAN operation. Validate configured origin, trusted proxies and root/subpath behavior. Do not enable development security shortcuts in local production.
- Neutral validated deployment configuration replaces personal resource IDs, domains, seeded editors and production defaults. Installation identity/settings belong in persisted installation data; resource bindings and secrets remain deployment configuration. Build/runtime must agree on the base path.
- Browser onboarding must create the first tree and first person without an existing relative. Add owner management for trees/settings/accounts and explicit reuse of existing people.
- GEDCOM import creates a new tree and therefore follows the agreed owner-only tree-creation policy. Preview and confirm it before commit; editors retain ordinary genealogy editing within existing trees.
- Import validates a declared supported GEDCOM subset, reports unsupported/unresolved input, creates a new tree, and never merges people automatically by name. Its commit must be atomic and revision-safe. GEDCOM is not full backup/restore.
- Refactor frontend behavior into explicit ES modules, separating shell/authentication, profiles/photos, forms, administration and viewer interactions where those responsibilities differ. Add browser type checking with one consistent approach. Preserve the current design system; no framework rewrite is required.
- Retain current revision-guarded mutations initially. Report conflicts clearly and require reload/retry rather than overwriting, automatically merging or claiming real-time collaboration.
- Activity history records actor, action, affected identity and time. Do not duplicate full private profiles, credentials or image contents into logs. Establish bounded retention during implementation.
- Accepted photo uploads remain immutable and retained after replacement, displayed-photo removal or person deletion. The current photo is a mutable pointer. Required primary/backup writes must succeed before pointer advancement. Local storage needs private paths, upload validation, traversal protection and atomic publication.
- Backups cover genealogy, memberships, stable/public IDs, settings, accounts, photo pointers and retained uploads. Keep latest state, seven daily recovery points and the most recent verified pre-upgrade snapshot. Reuse immutable photos rather than duplicating every image per snapshot.
- Encrypt off-device exports with a separately retained recovery key; document unrecoverability if it is lost. Support a configurable second local backup path and visible success/error/freshness status. Do not label a second directory as off-device merely because its path differs.
- Restore into fresh storage with integrity checks. Do not restore live sessions, pending invitation/reset capabilities or automation credentials. Use transaction-consistent database snapshots, not naive copying of a live WAL database.
- Upgrades are installer-started, preflighted, backed up and versioned. Prevent conflicting writes during schema transitions. Replace the previous pre-upgrade point only once the next upgrade's backup is verified. Code-only builds may deploy automatically; schema-changing releases require an explicit migration gate.
- Migrate the existing installation once, preserving all current genealogy and uploads. Existing approved emails establish account-approval intent, not trusted Google subjects. Verify owner recovery and secure access before retiring shared-password sessions. Normal operation supports only the new model; historical conversion tools are not permanent fallback modes.
- MCP remains an optional client of the same authoritative application. No second local data source or export/publish cycle. Use identifiable, owner-managed revocable automation credentials without expanding existing owner authority or inventing granular token scopes prematurely.
- Delivery sequence: foundations/neutral configuration; both production implementations; accounts/setup; creator/operations; staged migration/release. Use coherent reviewable checkpoints and preserve a working application throughout.

## Testing Decisions

- Prefer the existing high application/HTTP seam as the main behavioral test interface. Run the same externally observable correctness and authorization contracts against both production implementations. Storage interfaces exist because two real implementations vary, not to manufacture mocks.
- Test outcomes and invariants, not helper names, DOM construction details, SQL spelling or module organization. Keep pure model/layout/relationship/crop tests where they give precise coverage, and browser tests for behaviors an HTTP test cannot observe.
- Existing API, relative creation, GEDCOM export, public-ID, backup/recovery, photo-failure, caching and concurrency suites provide prior art. Preserve their coverage while adding production-local execution.
- Verify protected bootstrap and first-tree/first-person creation, including concurrent owner claims and absence of production seeds.
- Exercise invitation expiry/reuse, login/logout, revocation, local password reset, optional Google linking, owner recovery/transfer and last-owner protection. Test denied requests directly against backend operations, not merely hidden buttons.
- Verify permissions across every read/write/export/photo/suggestion/account/tree endpoint and MCP operation. Share links must preserve selection through authentication without bypassing it.
- Test both accepted and conflicting simultaneous edits, role changes during active sessions, import/write races and failed transactions with no partial genealogy or orphaned public IDs.
- Test GEDCOM supported-subset round trips, Unicode, preview/confirmation, unsupported input, invalid relationships, size bounds and all-or-nothing import. Equal names must not imply equal people.
- Verify authenticated private photo reads, viewer replacement/editor removal, retained immutable uploads, failed backup/object writes and atomic pointer updates on both implementations.
- Use synthetic browser fixtures for desktop/mobile, graph orientations/List, search, profiles, comparison, suggestion/edit dialogs, scroll regions, account setup and deep links. Preserve existing visual behavior rather than redesigning during architecture work.
- Block external networking after installation and verify local core login, administration, viewing, editing and uploads still work with bundled assets.
- Test container restart/replacement and explicit storage failure; never silently reseed or fall back to another store.
- Restore latest/daily/pre-upgrade points into fresh storage and compare records, IDs, memberships and retained image integrity. Verify expired/live credentials cannot regain access through restore. Include encrypted-export decryption and wrong/missing-key failure.
- Exercise destination outages, interrupted backup/photo writes and visible failure/freshness status. A successful scheduled invocation alone is not proof of recoverability.
- Rehearse upgrades and one-time existing-data conversion on synthetic fixtures first; verify immutable source-data fingerprints and photos around any separately authorized live cutover. Ensure incompatible versions fail clearly without permanent legacy readers.
- Extend CI with both-implementation contracts, browser type checks, meaningful browser E2E, schema migration checks, image/build checks and existing Python/web/security checks. Benchmark runtime/password choices before final selection; do not claim unmeasured capacity or zero-loss recovery.

## Out of Scope

- A centrally operated multi-tenant service, public signup, billing or a commercial SaaS account system.
- Per-tree/per-person/per-field permissions, public tree access or tokenized public share links.
- Multiple equal owners, additional administrator tiers, multiple social providers or required email infrastructure.
- A graph redesign, React/shadcn migration, real-time collaborative editing or automatic edit-conflict resolution.
- Automatic person/account matching by name or email and automatic cross-tree GEDCOM identity merging.
- New relationship categories or a broader genealogy model unrelated to this hosting/access work.
- Kubernetes, a mandatory separate database server, generalized storage plugins or silent provider failover.
- Permanent legacy authentication/routes, old-version runtime compatibility or a parallel local source of truth.
- Photo-history pruning, guaranteed unlimited free hosting, guaranteed zero data loss, or treating same-disk copies as disaster recovery.
- Destructive infrastructure changes, automatic live cutover or unreviewed production migration as part of publishing this spec.

## Further Notes

This spec synthesizes the approved private-hosting interview, research and architecture decisions. It is the implementation work item, not evidence that the feature exists. Research inspected source and official documentation; runtime prototypes, password benchmarks, production-local deployment tests and restore drills remain to be performed.

The testing direction preserves the previously reviewed API-first behavioral approach and both-deployment acceptance criteria. Dependency choices, exact retention for activity records, operational limits and cryptographic parameters are engineering validation tasks; they must not weaken the agreed requirements.

Remote access and offline operation are distinct: a local installation can function offline while remote relatives cannot reach it without connectivity. Public source code is compatible with private authenticated family data. Each installer remains responsible for uptime, secure endpoint configuration, updates and recovery-key custody.

Reference evidence: [SQLite deployment suitability](https://www.sqlite.org/whentouse.html), [SQLite WAL constraints](https://www.sqlite.org/wal.html), [SQLite backup](https://www.sqlite.org/backup.html), [Docker persistence](https://docs.docker.com/engine/storage/volumes/), [Miniflare development role](https://developers.cloudflare.com/workers/testing/miniflare/), [Google identity verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), [OWASP password storage](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Password_Storage_Cheat_Sheet.md), [OWASP authorization](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Authorization_Cheat_Sheet.md).
