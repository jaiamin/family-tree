# ADR 004: Recoverable data and explicit upgrades

Status: implemented; production cutover remains operator-approved.

Final interview decisions: encrypt off-device exports with a separately saved recovery key. Retain the most recent verified pre-upgrade snapshot and replace it only after the next upgrade's backup is verified. Exports use AES-256-GCM with authenticated record ordering; manifests and retained image bytes carry SHA-256 integrity checks.

Retain latest recoverable state plus seven daily recovery points and a verified pre-upgrade point. Preserve all accepted immutable photo uploads separately from replaceable current-photo pointers. Primary/backup write success precedes pointer advancement. Show backup freshness/errors and warn when protection exists only on the primary disk.

Provide consistent portable manifests with schema/version/integrity information and fresh-storage restore. Never restore live sessions or automation credentials. Document separate recovery-key storage and the consequences of losing it. Bound pre-upgrade retention using the agreed replacement policy above.

Upgrades are installer-started, preflighted, backed up and versioned. Preserve UUIDs, short IDs, genealogy and photo objects. Do not import preview data, reseed existing databases or silently open a fallback store. One-time old-format conversion is an upgrade tool, not a permanent legacy runtime. Code-only releases may automate deployment; schema transitions need an explicit migration gate.
