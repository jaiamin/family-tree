# ADR 001: Installation-wide access

One installation owns one collection and any number of trees. Trees group shared people; they are not privacy boundaries. Membership includes a person in a tree; relationships appear when both people belong to it. A person keeps the same UUID and public ID across trees. Public IDs are short URL locators, not credentials. Login users are separate from genealogical people.

Use one family viewing password, approved Google editors and one deployment-configured owner. Enforce permissions server-side; share links grant no access. Deleting a tree preserves people and uploads.

No public signup, per-tree permissions or automatic person/account matching. See [roles](../../README.md#host-your-own) and [identity](adr-003-identity-and-recovery.md).
