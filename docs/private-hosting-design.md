# Private hosting design — discovery

Status: plan confirmed; specification published as GitHub issue #34 with ready-for-agent. Implementation has not started.

## Goal and acceptance criteria

Enable independent families to install, privately manage and share their own family-tree website. Preserve the existing graph UI, stable person identities, relationships and immutable photos. Produce an evidence-backed architecture and migration plan before implementation.

## Agreed decisions

- Support production hosting on a family's own computer/server alongside Cloudflare.
- Each installation owns its data, owner and invited users, and may contain multiple trees. No centrally operated multi-tenant service is planned.
- The installer can follow technical instructions and run commands. Family management after setup should be browser-based.
- Remote relatives use ordinary HTTPS browser access without mandatory VPN software.
- After installation, core local viewing, editing, photo uploads and administration must work without internet access. Remote access still requires connectivity; Google cannot be the only administrative sign-in method.
- Use owner-approved individual login accounts instead of a shared family password; no public signup. Individual access must be revocable.
- Grants apply across all trees in an installation for the initial design. Per-tree authorization is out of scope.
- Viewers may submit suggestions and add/replace photos, but cannot remove photos or edit genealogy. Editors can edit people and relationships. Previous photo uploads remain retained.
- Login accounts are separate from genealogical people; a person does not require an account and matching must never be automatic merely because names match.
- Owner alone creates, renames and deletes tree groupings and manages accounts. Deleting a grouping preserves people and photos, including shared records.
- Provide an offline owner recovery code and a server-side recovery command. Recovery restores access without resetting genealogy.
- Retain the latest recoverable state plus seven daily recovery points. Photos remain immutable and are not duplicated into every database snapshot. This is the proposed new design, not a change to existing production retention.
- Recommend Docker Compose for local production with persistent storage; no separate database server or Kubernetes requirement.
- Local backups support a second path (external drive or mounted network folder) without requiring internet. Show warnings for same-disk-only protection and persistent backup failures. A second path alone does not prove off-device storage.
- Owners issue expiring single-use invitations and share links themselves; relatives choose username/password. Email delivery is not required. Google is optional and must link explicitly to an approved account.
- Preserve graph/List/profile/comparison/search/sharing behavior; no visual or framework rewrite without a concrete requirement.
- Include validated GEDCOM import with preview into a new tree; never merge people automatically by name. Complete installation migration uses backup/restore, not GEDCOM alone.
- Installer explicitly starts upgrades. Require a verified pre-upgrade backup and versioned schema migrations; code rollback alone is not database recovery.
- Converge on one current application/domain/auth design. Use explicit one-time migrations and remove superseded runtime paths; do not maintain old-version compatibility modes or silent storage/auth fallbacks. Local and Cloudflare remain two explicitly selected deployment implementations because both are agreed requirements.
- Migrate approved owner/editor access into the new account model, requiring secure credential establishment/linking and fresh sign-in. Retire shared viewing passwords; invite existing viewers individually. Preserve family data.
- Permanent person deletion stays owner-only. Provide a small owner-visible activity history for edits/imports/deletions/access changes without logging credentials, image data or duplicate full private records. History is accountability, not undo.
- Preserve revision-guarded writes. Conflicting browser saves explain the conflict and require reload/retry, never silently overwrite; automatic merging and live collaborative editing are out of scope.
- Use one owner with explicit ownership transfer and protection against removing the last owner.
- Encrypt off-device backup exports; installer retains the recovery key separately. Document that losing the key makes encrypted backups unrecoverable.
- Keep the most recent verified pre-upgrade snapshot. Replace it only once the next upgrade's backup is verified, alongside the latest recoverable state and seven daily recovery points.

## Decision frontier

All interviewed product decisions and the phased plan are confirmed. The user invoked to-spec to publish the specification rather than start application changes in this turn. Canonical work item: https://github.com/jaiamin/family-tree/issues/34. Local spec: `docs/private-hosting/spec.md`. Research synthesis is in `reports/Private family tree hosting.md`; ADRs and glossary are in `docs/private-hosting/`. Runtime/package selection and cryptographic parameters require engineering validation. Live cutover, resource deletion and production migration require a concrete reviewed procedure.

## Research

Parallel investigations cover hosting/storage/recovery, identity/access/privacy, and existing-code changes. Notes: `research_notes/Private family tree hosting/`. Sources and recommendations will be distinguished from confirmed decisions.

Initial findings: the local server is a development simulator, not a supported production deployment. A real local runtime/storage implementation is needed. Browser onboarding cannot yet create the first person without an existing relative. Trees share people and relationships, so per-tree permissions would require explicit shared-person policies. Offline operation also requires removing mandatory external authentication and font dependencies. Preserve the existing graph, domain rules, UUIDs, public IDs and photo-retention guarantees.

## Working glossary

- **Installation:** one independently operated application and its private storage.
- **Tree:** a named family grouping within an installation; precise visibility rules remain undecided.
- **Person:** one identity within an installation, potentially appearing in multiple trees.
- **Installer:** the person who provisions and maintains the deployment.
- **Owner:** the application administrator; exact capabilities remain under discussion.

## Next action

Implement issue #34 in reviewable phases when work resumes. Preserve existing UI/data and validate both production deployments before any separately reviewed live cutover. No application, production data or infrastructure changes have been made during specification.
