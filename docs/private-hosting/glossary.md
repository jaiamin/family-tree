# Private hosting glossary

| Term | Meaning |
|---|---|
| Installation | Independently operated website, authoritative database, private uploads, backups and access rules. |
| Collection | Shared genealogy and tree definitions within one installation. |
| Tree | Named membership view over the collection; not a separate privacy scope. |
| Person | Genealogical identity with stable UUID, reusable across trees and distinct from a user. |
| Relationship | Parent/partner connection between people; displayed when its endpoints belong to the selected tree. |
| Membership | Inclusion of a person in a tree. |
| User | Named authenticated account carrying an installation-wide role. |
| Identity | Credential/provider identity explicitly attached to a user; Google uses provider and stable subject. |
| Viewer | Approved user who views, suggests and uploads/replaces photos, but cannot edit genealogy. |
| Editor | Approved user who manages people/relationships, suggestions and displayed-photo removal. |
| Owner | Installation administrator managing access/settings/trees and permanent person deletion. |
| Installer | Operator provisioning, upgrading and recovering the deployment; not necessarily a genealogical person. |
| Invitation | Expiring single-use permission to establish an approved account. |
| Session | Revocable authenticated browser access, not a genealogical identity. |
| Automation credential | Individually revocable API authority used by MCP or scripts; not a second data store. |
| Photo upload | Immutable accepted image object retained after replacement or person deletion. Current UI uploads a square crop, not necessarily the original camera file. |
| Current photo | Mutable pointer selecting one retained upload for display. |
| Public ID | Permanent short locator used in URLs, not an access credential. |
| Share link | Private record locator that still requires authorization. |
| Backup | Consistent recoverable records plus referenced retained uploads; daily recovery points supplement latest state. |
| Restore | Deliberate recovery into fresh storage, excluding live authentication capabilities. |
| Migration | Explicit schema/data conversion into the single current model; not an ongoing legacy mode. |
| Offline | Core local operation without internet after setup; does not imply remote reachability. |
