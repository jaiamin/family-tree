# Hosting and recovery

## Deployment

The Worker serves every page/API/photo through authentication. D1 holds people, relationships, memberships, photo references, suggestions, and access settings. Two **private** R2 buckets hold uploaded images and their backup copies. Never enable public bucket access.

1. Configure your account, D1/R2 bindings, owner email, Google client ID, and public origin in `web/cloudflare.config.ts`. For a new installation, create your own resources; the checked-in IDs belong to this deployment.
2. Apply `web/schema.sql` to the **new** D1 database. Add approved editors through owner access or the `editors` table. Do not import into an existing populated website.
3. Set Worker secrets **FAMILY_PASSWORD** and **MCP_TOKEN** through Cloudflare's dashboard or interactive secret prompts. Generate a strong independent MCP token. Never put secrets in source, command arguments, or documentation. Never set LOCAL_MODE in production.
4. Build and deploy with `pnpm --dir web deploy`. Deployment updates code, not existing records or photos. There is no automatic production deployment from the MCP or this repository's CI.
5. Google OAuth: configure a Web application client with your exact website origin as an authorized JavaScript origin (and localhost:8000 for development). The browser callback uses Google Identity Services; no redirect URI is needed. Only owner/approved editor emails gain editing access.

### Existing custom domain on Vercel

The Astro portfolio in `jaiamin/website` remains on Vercel. Create `vercel.json` at that repository’s root with these rewrites **before catch-all rewrites** in its own repository, replacing the Worker hostname if needed:

```json
{
  "trailingSlash": false,
  "rewrites": [
    { "source": "/family-tree", "destination": "https://family-tree.jaiamin.workers.dev/family-tree/" },
    { "source": "/family-tree/:path*", "destination": "https://family-tree.jaiamin.workers.dev/family-tree/:path*" }
  ]
}
```

`trailingSlash: false` redirects previously shared URLs ending in `/` to their canonical paths before proxying. Without this, Vercel can return its own 404 for a tree even though the Worker accepts the route.

Ensure the portfolio middleware does not intercept this path. Test Google sign-in, cookies, photos, and deep links through the custom domain; testing the Worker hostname alone is insufficient.

## Repository name

Repository: [jaiamin/family-tree](https://github.com/jaiamin/family-tree). The local MCP package and command remain `family-tree-mcp`. Repository renames do not change the website, Worker, or data; update the Git remote, source link, and any connected Cloudflare build afterward.

## GitHub deployments

After this code is merged, connect the Worker to the GitHub repository in **Settings → Builds**. Use production branch `main`, root directory `web`, build command `pnpm build && pnpm exec vite build`, and deploy command `pnpm exec cf deploy --prebuilt --mode production`. Set the build Node version to 26. Disable non-production deployments against the live database. Cloudflare may require the owner to authorize its GitHub application and build token. No deployment trigger is enabled by this change.

## Initial migration

- Use the authoritative `collection.json` from the current owner machine, not a preview fixture. MCP `import_collection(path)` loads it into an empty hosted website, preserving person/tree UUIDs and stripping obsolete static-site settings. It refuses a populated destination.
- Migrate existing photos **before cutover**, matching their original person UUIDs. Existing public Pages/KV storage must remain untouched until record counts, relationships, UUIDs, and every current photo are verified in the private destination. This installation migrated the two published trees only; obsolete legacy photo storage was removed at the owner’s request.
- After verification, retire old public Pages deployments and public photo access. Protecting the new Worker does not retroactively make those old URLs private.

## Backups

- After each successful data/photo/access/suggestion write, the Worker asynchronously refreshes **one** `collection.json` manifest in the private backup bucket. It includes all records, current photo pointers, every registered upload, suggestions, and editor access.
- A scheduled trigger retries every 15 minutes. Owner session/MCP `get_website` exposes backup status; failures appear in the owner's menu. This is not per-edit undo: accidental deletions also enter the next backup.
- Each photo upload gets an immutable key containing the person UUID and upload UUID. Both buckets receive the bytes **before** the current-photo reference changes. Editors may remove the displayed photo; this clears only its current reference and keeps every upload. Replacing a photo retains all previous uploads; no automated pruning or deployment cleanup removes them. The browser uploads a square profile crop, not the untouched camera file.
- Sessions and temporary login/rate-limit data are intentionally excluded. People sign in again after recovery. Separate buckets protect against main-storage failure, not loss of the entire Cloudflare account; no zero-loss guarantee.

## Disaster recovery

`web/src/recovery.ts` exports the maintenance-only `recoverBackup(env)` operation; it is deliberately unavailable to browser visitors and MCP clients.

1. Stop writes to the damaged installation. Keep its database/buckets intact.
2. Create a fresh D1 database, apply the schema without seeding editor records, and create a fresh private primary photo bucket. Bind these as DB and PHOTOS, with the **existing** backup bucket as BACKUP, in an isolated maintenance Worker.
3. Invoke `recoverBackup` once through a trusted maintenance entrypoint. It validates the manifest, requires an empty database, checks that every retained photo exists, copies all originals, then restores records and photo pointers in one D1 batch. It refuses conflicting destination photos and never modifies the backup. An interrupted copy can be rerun against the still-empty destination database.
4. Verify person/tree/suggestion counts, relationships, current photos, and retained uploads before changing production bindings. Remove the temporary maintenance Worker afterward. Reconfigure authentication secrets separately.

The automated recovery test restores into fresh D1/R2 storage and compares photo bytes. Run a production restore drill before relying on a new installation.

Owner-only person deletion removes the person from all trees, relationship links, and current photo references, with name/revision confirmation. Immutable uploads stay in both buckets. Deletion is reflected in the rolling backup; it is not an undo history.

## GEDCOM export

Open a tree and choose **Download GEDCOM** from the top-right menu. Any signed-in family viewer can export that tree as GEDCOM 5.5.1, including people, recorded gender, dates, places, notes, and relationships. People outside the tree and photos are excluded. Person UUIDs are retained in `_UID` fields; free-text dates are preserved as event notes. This is a portable download, separate from the automatic recovery backup.
