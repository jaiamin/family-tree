# Private hosting — final CI pending

PR: https://github.com/jaiamin/family-tree/pull/55 · branch agent/ux-c8284e07. Do not merge automatically.

Latest approved design: one shared family password for viewers; Google only for approved editors and the configured owner. Same frontend/domain on Docker and Cloudflare; optional MCP uses URL/token. No viewer accounts, local account passwords, invitations or runtime legacy modes. ADR003 supersedes the initial authentication proposal.

Implemented and reviewed: deployment adapters, access/creator tools, immutable photos, cross-host encrypted recovery, bounded snapshots, concise setup docs. Successful password logins reset failed-attempt counters; failed guesses retain lockout. Paginated backup listing supports hundreds of uploads without per-photo Worker requests. Google identity changes trigger backups.

Verification: 61 web tests, 88 Python tests, backend/browser types, Ruff/ty, Chromium desktop/mobile at normal/root/nested paths, Docker image without networking, Vite/dry-run, workflow lint and secret scanning pass. Independent standards/spec reviews found no remaining blocker. Latest authentication follow-up needs final CI.

Cloudflare migration/configuration verified: all ten genealogy tables match the source; 161 people,2 trees,182 parent links,21 partnerships,165 memberships,163 public IDs,2 retained/current photos,revision22. Existing editor approvals preserved; first verified Google login binds subjects. Backup generation170 saved170,errornull. Hosted password/view/logout checks pass on Free; completed sampled requests use1–6ms CPU. Temporary verification Workers/schedule/table/sessions removed; obsolete setup secret removed. Original data/photos remain preserved and core writes frozen until merge/cutover. Production code/bindings stay old until merge; connected main build now targets verified final storage. No paid plan enabled.

Owner next: merge PR after green CI; connected Cloudflare build deploys. Enter existing family password, then menu Edit → owner Google sign-in. Recreate optional MCP credential in Agent access. Real interactive Google login remains owner acceptance; signed-token authorization is automated. Preserve original storage until live acceptance. Private rollout config/evidence is ignored under web/.local/rollout. Never commit family records/secrets or preexisting untracked research directories/ticket-index.
