# ADR 001: Installation-wide family access

Status: product decision and final plan agreed; implementation pending.

Each independent installation owns one collection of shared people and relationships and may expose multiple named trees. Trees are membership views, not authorization scopes. A person retains its UUID and public ID across trees; changes propagate wherever included. Login users are separate from people.

Use invited named accounts with owner/editor/viewer roles across the installation. Viewers view, suggest and add/replace photos; editors manage genealogy, suggestions and displayed-photo removal; owner manages accounts, settings and trees and permanently deletes people. Deleting a tree preserves people and retained uploads. Share links locate records and never grant access.

No public signup, multi-tenant service, per-tree ACLs or automatic name-based person/account matching. Server-side checks apply to every operation. Use one owner with explicit transfer and protection against removing the last owner, as confirmed in the final interview.
