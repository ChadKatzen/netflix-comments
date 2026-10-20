# netflix-comments

Time-bound comments on Hulu and Netflix. Comments are pinned to a moment in the show (SoundCloud-style timeline), with
Live / Top / New tabs, likes and replies (TikTok-style), a spoiler guard that hides comments ahead of where you
are, and pop-up bubbles as the playhead passes comments.

Built as a **Chrome extension** (the only way to overlay the real Netflix player) plus a tiny comment service
designed for **availability over consistency**: reads are static JSON behind a CDN, so millions of viewers cost
roughly nothing, and the extension keeps working on stale/cached data when the server is unreachable.

```
┌──────────────┐   GET t/<id>/meta.json, t/<id>/b/<n>.json   ┌───────────────────┐
│  extension   │ ──────────────────────────────────────────▶ │ CDN / static JSON │  (reads: cached, ~free)
│ (Netflix tab)│                                             └───────────────────┘
│  local cache │   POST /api/titles/<id>/comments            ┌───────────────────┐   cron/1 min   ┌────────┐
│  + outbox    │ ──────────────────────────────────────────▶ │  write API + DB   │ ─────────────▶ │snapshot│
└──────────────┘   POST /api/comments/<id>/like              └───────────────────┘   re-render    └────────┘
```

## Quick start (local)

```bash
cd server && npm start          # http://localhost:3131  (Node >= 22.5, zero dependencies, SQLite built in)
```

1. Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick the `extension/` folder.
2. Open the mock player: <http://localhost:3131/watch/demo> (a silent 10-minute clip; add `?src=bbb` for real
   video). The comment drawer appears on the right.
3. Or open an episode on <https://www.hulu.com/watch/…> or <https://www.netflix.com/watch/…>. Same drawer, keyed
   per episode (`hulu-<uuid>` / `nf-<id>`).

The extension defaults to the deployed server for Hulu/Netflix and to `http://localhost:3131` on the mock player.
Change either URL under *Advanced* in the toolbar popup.

## Using it

| Action | How |
|---|---|
| Show / hide the drawer, focus the composer | `Shift+C`, or the pill on the right edge |
| Comment on this moment | Type in the composer. The red time chip freezes at the moment you started typing. `Enter` posts, `Esc` cancels. The video pauses while you type and resumes when you post. |
| Read what people said here | **Live** tab: comments in time order, the ones from the last ~25 s highlighted as *happening now*, auto-scrolls with playback. |
| Best comments | **Top** tab (by likes, then replies). **New** tab is newest first. |
| Spoiler guard | Comments ahead of the playhead are hidden by default. Eye icon in the header or "Show anyway" reveals them. |
| Jump to a moment | Click a comment's time pill, or click the density strip under the header. |
| Likes, replies, delete | On each comment. Replies inherit the parent's timestamp. You can delete only your own. |
| Pop-ups | With the drawer closed (or on Top/New), passing a comment pops a bubble bottom-left for ~6 s of playback. Pause and they stay until you resume. Click one to open the drawer there. |
| Fullscreen | Works; the overlay follows the player into fullscreen. |

Identity is an anonymous id generated on first use (see popup → Identity). There is no login; see Limitations.

## How it scales cheaply (availability over consistency)

* **Reads never hit a database.** Each title's comments are rendered to static JSON: `t/<id>/meta.json`
  (name, counts, a 10-second density histogram for the strip, top-100 by likes, newest-50) and one
  `t/<id>/b/<n>.json` per 5-minute bucket. The extension fetches the bucket around the playhead ±1 as you watch.
  Snapshot responses carry `Cache-Control: public, max-age, stale-while-revalidate`, so a CDN serves almost
  everything. Cost of a viewer is ~0.
* **Writes are rare by comparison** (most viewers never post). They go to a small API that appends to SQLite/D1
  and marks the title dirty; dirty titles are re-rendered on a timer. Staleness is seconds to ~2 minutes.
* **The client assumes staleness.** Your own posts and likes are overlaid locally and shown immediately; snapshots
  are cached in `chrome.storage` so the drawer works offline; failed writes sit in an outbox and retry. Liked
  state is tracked client-side so snapshots are identical for every user (and therefore cacheable).
* Snapshot files are the contract. Any host that can write files and serve them with cache headers works.

### Deployed on Cloudflare (free tier) — live since 2026-10-18

Production: **https://netflix-comments-api.katzen-chad.workers.dev** (write API, and reads of `/t/*` served from R2 through the Worker). The extension
defaults to it. `edge/` holds the Worker (write API from **D1**, a minute cron that renders dirty titles to
**R2**), and `edge/deploy.sh` recreates the whole thing:

```bash
cd edge && npx wrangler@4 login && ./deploy.sh
```

Account prerequisites, both one-time clicks in the dashboard: a `workers.dev` subdomain, and the R2
subscription (free tier: 10 GB, 10M reads/month, $0 due). Verified live: health, title, comment, like,
validation, cron render, snapshot read with cache headers.

To go from "free for friends" to "free for millions", move reads off the Worker: give the R2 bucket a public
custom domain, add a cache-everything rule (edge TTL ≥ 60 s), set `SERVE_SNAPSHOTS = "false"` in
`wrangler.toml`, and point the popup's *read URL* at the bucket domain. Cached reads then invoke nothing and
cost nothing; writes stay well inside free tiers unless comment volume is enormous.

### Self-hosting instead

`server/` is production-usable for a single box: put Cloudflare (free plan) or any CDN in front of it and set
`SNAPSHOT_CACHE` to a longer TTL. Env: `PORT`, `DB_PATH`, `SNAP_DIR`, `SNAPSHOT_CACHE`.

## API (write side)

| Method | Path | Body |
|---|---|---|
| `PUT` | `/api/titles/:videoId` | `{ name, duration }` |
| `POST` | `/api/titles/:videoId/comments` | `{ t, body, authorId, authorName, parentId? }` → 201 comment |
| `POST` | `/api/comments/:id/like` | `{ userId }` → `{ liked, likeCount }` (toggle) |
| `DELETE` | `/api/comments/:id?user=ID` | author only |
| `GET` | `/api/health` | counts |

Read side: `GET /t/:videoId/meta.json`, `GET /t/:videoId/b/:bucket.json` (404 = nothing yet).

## Testing

`dev/e2e.mjs` drives a real Chrome with the extension loaded against the mock player over the DevTools protocol
(no dependencies) and checks 24 behaviours: injection, title/meta/histogram, live highlighting, spoiler guard,
pause-on-compose, optimistic post → server ack, likes, replies, Top sorting, keyboard isolation, pill/toasts,
no console errors, popup health check.

```bash
cd server && npm start &
npx @puppeteer/browsers install chrome@stable      # Chrome for Testing; branded Chrome ignores --load-extension since 137
node dev/e2e.mjs                                   # or CHROME_BIN=/path/to/chrome node dev/e2e.mjs
node dev/tour.mjs                                  # opens a visible window, seeds a title, screenshots each state
```

`dev/tour.mjs` is the "use it like a viewer" walkthrough: it seeds 28 comments with likes and replies, then screenshots
landing, live, replies, composing, posted, Top, spoilers shown, pop-ups with the drawer closed, pop-ups surviving a
pause, fullscreen, New, and a small window. Add `KEEP=1` to leave the browser open afterwards.

Verified here: 24/24 on Chrome for Testing 148. On Chrome for Testing 155 headless, 23/24: that build refuses to
serve extension files from subdirectories to the service worker (hence `popup.html` lives at the extension root).

## Sites

Site-specific behaviour lives in `extension/content/sites.js` (one adapter per site: player-page detection,
episode id, title, which `<video>` is the show, content clock, seek, play/pause, where to mount the overlay).

### Hulu — verified on the live player (2026-10-18)

Checked by injecting the overlay into a logged-in Hulu tab (`dev/build-inject.mjs` builds a shimmed bundle for
that) and driving it like a viewer. What Hulu does differently, and how the adapter copes:

* **Ads are stitched into the stream.** `video.currentTime` runs ahead of the content position by the ads already
  played (48 s into "9-1-1: Nashville" S1E1). The adapter reads Hulu's own timeline (`.Timeline__slider`
  `aria-valuenow` / `aria-valuemax`, in seconds, updated every second whether or not controls are shown) as the
  content clock and remembers the offset.
* **Setting `video.currentTime` stalls the stream** (Hulu only buffers around *its* position). Seeks are done by
  clicking Hulu's timeline synthetically at the fraction for the target time; accuracy is ~2 s.
* **Hulu's controller re-asserts play state.** Pause/resume fall back to Hulu's play/pause toggle when the
  element call doesn't stick.
* **Hulu's player has a focus trap.** Focus outside `.ContentPlayer` snaps back to a player button, so the overlay
  is mounted inside it; pointer and focus events are stopped at the overlay root.
* Title: `.PlayerMetadata__titleText` + `.PlayerMetadata__subTitle` → "9-1-1: Nashville · S1 E1 - Pilot".
  Video: `#content-video-player` (not `#ad-video-player`, `#intro-video-player`, or the preview player).

Verified live: injection, title, clock, typing with spaces inside the composer without triggering Hulu hotkeys,
pause on compose, posting, seeking from a comment's timestamp, pop-ups as playback passes a comment.

### Netflix — not yet verified

Netflix has never been exercised live; the mock player mirrors its URL shape, a plain `<video>` and document-level
hotkeys. The title selector (`[data-uia="video-title"]`, visible only while controls are shown), seeking via
`video.currentTime`, and fullscreen re-parenting are best-effort until tried.

## What is **not** verified

* **Netflix itself** (above).
* Nothing else: Cloudflare deployment verified live 2026-10-18.

## Limitations / next steps

* No auth: identities are client-generated and spoofable; the only abuse control is a per-IP rate limit.
  Real accounts (e.g. Cloudflare Access, Turnstile, or OAuth) are the first thing to add before opening it up.
* No moderation or reporting yet.
* Very busy titles: `meta.json` holds only top-100/newest-50 and each 5-minute bucket is one file; a bucket with
  tens of thousands of comments gets large. Next step is paging the bucket file or lowering `BUCKET_SECONDS`.
* Chrome only (Manifest V3). Firefox would need a small manifest change.

## Layout

```
extension/         Chrome extension (MV3): content/ overlay (+ sites.js adapters), background.js fetch proxy, popup.html
server/            Node dev/self-host server: write API + snapshot renderer + mock player (public/)
server/shared/     routes, SQL, snapshot builder — shared with the Worker
edge/              Cloudflare Worker (D1 + R2 + cron) — unverified
dev/e2e.mjs        end-to-end browser test
dev/tour.mjs       visible-browser viewer walkthrough with screenshots
dev/build-inject.mjs  builds dev/inject.js, a shimmed bundle to paste into a real player page (OFFLINE=1 = fake data)
```
