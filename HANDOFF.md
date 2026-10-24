# Handoff: photos on the shared site

## Goal
Anyone viewing the published family tree can add, change or remove a person's photo. Photos
persist on Cloudflare (not the user's machine), survive refreshes and republishes, and removing a
photo returns the circle to the person's initials.

## Decisions (agreed with the user)
- **Who can edit:** a family edit code. Viewing stays open; uploading, changing or removing asks
  for the code once per device. `publish_site` creates it and reports it; `change_photo_code`
  replaces it.
- **Living people:** photos are shown for everyone; `hide_living` still only hides dates/notes.
- **Storage:** Workers KV (free tier, no payment card), not R2 (needs a card).
- **Shape:** the published site becomes a Pages project folder: `public/index.html`,
  `functions/api/photos/[[path]].js` and `wrangler.toml` (KV binding `PHOTOS`, var
  `EDIT_CODE_HASH` = SHA-256 of the code, so the code itself is never stored on Cloudflare).
- **KV layout:** `photo:<id>` holds the image with metadata `{v, type}`; `index` holds
  `{id: v}`, so page views cost one KV read. KV's free tier allows only 1,000 list calls a day.
- Photos are cropped to a square and shrunk to 512 px JPEG in the browser before upload.
- `export_html` (offline file) has no photo support and shows initials.

## Acceptance criteria
- [x] Tapping the big circle offers Add photo, or Change and Remove once one exists.
- [x] The first edit on a device asks for the family code; a wrong code is rejected with a message.
- [x] Photos appear in the tree cards, the person card and search results, and survive a reload.
- [x] Remove returns the circle to initials.
- [x] Republishing the tree keeps the photos.
- [x] `publish_site` creates the KV store once and returns `photo_code`; `change_photo_code` works.
- [x] Sites published before this change keep updating without photos until republished.
- [x] Tests cover the function (auth, validation, index) and the publish flow with fake wrangler.
- [x] Verified end to end locally with `wrangler pages dev` in a browser (upload, reload, remove).

## Progress
- [x] Pages Function `photos.js`
- [x] Python: Site fields, site folder layout, KV setup, code generation, `change_photo_code`
- [x] Page UI
- [x] Tests, README, local end-to-end check

## Verification
- ruff, ty, pytest (83) on Python 3.14 and 3.10.
- `tests/test_photos.py` runs the Pages Function in Node against a fake KV (auth, validation,
  index, delete, caching). `tests/test_publish.py` covers KV setup, code generation, republish,
  `change_photo_code` and sites published before photos, with a fake wrangler.
- End to end in `wrangler pages dev` with a local KV, in a browser at 1440px and 390px: wrong
  code rejected, right code saved, upload shows in the card and tree, survives reload, remove
  returns to initials.
- A flaky failure (deploy reading a half-written page) was fixed by writing site files atomically.

## Blockers / limits
- The sandbox cannot reach the Cloudflare API, so real deployment is untested here; the user
  must run the first publish (KV namespace creation included).

## Next action
Wait for PR #11 to merge, then `git merge origin/main`, push, and open a draft PR for photos.
