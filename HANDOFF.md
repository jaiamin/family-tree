# Handoff: "Ask" chat on the published site

## Goal
Anyone viewing a published tree can ask questions about it in plain language and get correct,
short answers from Claude Haiku 5.5. It runs on Cloudflare next to the photo service, uses the
owner's own Anthropic API key, can't change anything, and never sees hidden details.

## Decisions (agreed with the user)
- Model `claude-haiku-5-5`, effort `low`, the owner's Anthropic console API key.
- Open to every visitor; cost bounded by a site-wide daily cap (200, `ASK_DAILY_LIMIT` var) plus
  the console spend limit.
- The MCP stays the local editor; the key never passes through the agent or MCP.

## Design
- Each tree publishes `trees/<id>/data.json` (the same public data the page embeds).
- `functions/api/ask.js` (source `src/family_tree_mcp/ask.js`): `GET` → `{enabled}`;
  `POST {tree, messages}` → `{answer}`. Tree sent as cached compact text with refs (P1…);
  tools `find_people`, `relatives`, `connection` (chain of names); refs rewritten to UUID links.
- Page: "Ask about the family" pill (bottom left) opens a side panel / bottom sheet; example
  questions from real people; names in answers focus the person; conversation kept per tab.

## Acceptance criteria
- [x] Ask button appears only when the published site has a key; hidden in local previews.
- [x] Relationship questions answer with a chain of names via `connection`.
- [x] Names in answers are tappable and focus that person in the tree.
- [x] Off-topic requests: prompt rules + refusal handling (fake Claude only; see limits).
- [x] Daily cap 429; bad input 400; unknown tree 404; missing key 503; API errors 502.
- [x] Hidden details of living people are never sent to Claude.
- [x] Works at 1440px and 390px, light and dark.
- [x] Node tests with fake Claude/KV/assets; Python tests; end-to-end in `wrangler pages dev`.
- [x] README and agent instructions explain the key setup.

## Verification
- ruff, ty, pytest (106) on 3.14 and 3.10. Mutations of ask.js caught by tests.
- `wrangler pages dev` + scripted fake Messages API: GET enabled, relationship chain, list,
  bold+link, off-topic, error + retry, reload keeps chat, Escape, chat ↔ person card.

## Blockers / limits
- No real Claude call made (costs the user money). Answer quality with real Haiku unverified.
- KV counter isn't atomic; bursts can slightly exceed the cap.

## Next action
Open PR; offer the user an optional live check with real Haiku.
