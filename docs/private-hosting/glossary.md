# Data model

| Term | Meaning |
|---|---|
| Installation | Independently hosted app, database, uploads, backups and access policy. |
| Collection | All genealogy and tree definitions in one installation. |
| Tree | Named group of people; not an authorization boundary. |
| Person | Genealogical identity with a stable UUID, shared across trees. |
| Membership | Inclusion of a person in a tree. Relationships appear when both endpoints belong to it. |
| User | Approved Google editor/owner, separate from a person. |
| Public ID | Permanent short URL locator; never an access credential. |
| Upload | Immutable accepted photo, retained independently of its current display pointer. Browser uploads are square crops. |
| Automation token | Revocable API access for MCP/scripts; no separate data store. |

See [permissions](../../README.md#host-your-own), [architecture](adr-002-two-deployments-one-application.md) and [recovery](../operations.md).
