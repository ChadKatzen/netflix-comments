# Chrome Web Store listing — Stream Comments

Item id: `ppebabldjhgohfhpjdfpdbloddnpmbfi` (created 2026-10-18 via the API).

Package uploads and publishing are automated: `node dev/build-store.mjs` builds the zip, then
`node dev/cws.mjs upload dist/stream-comments-<version>.zip` and `node dev/cws.mjs publish` (credentials in
`~/.config/cws/`, set up once with `auth-url` / `auth-serve`). The store listing, screenshots and privacy answers
below are dashboard-only (no API) and were pasted by hand.

## Store listing

**Name:** Stream Comments

**Summary** (≤132 chars):
Time-stamped comments on Hulu and Netflix: see what people said at this exact moment, with top comments and a spoiler guard.

**Category:** Entertainment · **Language:** English

**Description:**
Stream Comments adds a comment layer to the Hulu and Netflix web players, pinned to the moment in the episode.

• Live: as you watch, comments from this exact moment surface in the drawer. Pause on a big scene and read what everyone said about it, or add your own.
• Top and New: the most-liked and most recent comments for the episode, TikTok-style, with likes and replies.
• Timeline: a density strip shows where the conversation is. Click a comment's timestamp to jump there.
• Pop-ups: with the drawer closed, comments float up as you pass them, and stay while you're paused.
• Spoiler guard: comments from later in the episode are hidden until you get there. Turn it off any time.
• Pause while you type, resume when you post. Shift+C toggles the drawer.

No account needed. You pick a display name; everything else is anonymous. Comments are public to everyone using the extension on the same episode.

Works on hulu.com and netflix.com watch pages. Not affiliated with Hulu or Netflix.

**Privacy policy URL:** https://netflix-comments-api.katzen-chad.workers.dev/privacy

**Homepage / support URL:** https://github.com/ChadKatzen/netflix-comments

**Screenshots** (1280×800): `store/screenshots/1-live.png` … `5-spoiler-guard.png`
**Icon** (128×128): `extension/icons/128.png`

## Privacy practices tab

**Single purpose:** Show and post time-stamped viewer comments on Hulu and Netflix player pages.

**Permission justifications**

- `storage` — saves the user's display name, settings, anonymous id, and a cache of comments for recently watched episodes so the drawer works offline.
- Host permission `https://*.workers.dev/*` — the extension's comment server (reads cached comment snapshots, posts comments/likes). Fetched from the background service worker; no other hosts are contacted.
- Content script on `*://*.netflix.com/*` and `*://*.hulu.com/*` — required to draw the comment drawer over the player and read the player's current playback time.

**Remote code:** No. All code ships in the package.

**Data usage disclosure** — check:
- *Personally identifiable information:* No (display name is user-chosen and optional; no email/name/address).
- *Authentication information:* No.
- *Personal communications:* No.
- *Location:* No. *Web history:* No. *User activity:* No. *Website content:* No.
- *User-generated content:* **Yes** — comments and likes the user posts, with the episode id and timestamp.

Certify: not sold to third parties; not used for purposes unrelated to the single purpose; not used for creditworthiness or lending.

## Distribution

Visibility: **Unlisted** to start (anyone with the link can install; not searchable). Switch to Public later.
Regions: all.
