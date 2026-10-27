# ADR 004: Preservation and explicit upgrades

Retain every accepted immutable photo in primary and backup storage before advancing its display pointer. Replacement, removal and person deletion never prune uploads.

Keep latest state, seven daily points and one verified pre-upgrade point. Replace that pre-upgrade point only after verifying its successor. Portable exports use AES-256-GCM, authenticated record ordering and SHA-256 integrity checks; save recovery keys separately.

Restore only into fresh storage, excluding sessions and automation credentials. Preserve UUIDs, public IDs and genealogy. Schema upgrades require explicit, tested conversions; no automatic reseeding, preview imports or runtime legacy fallback. See [operations](../operations.md#upgrades).
