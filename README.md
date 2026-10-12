# netflix-comments

Time-bound comments on Netflix. Comments are pinned to a moment in the show (SoundCloud-style timeline), with
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
3. Or open anything on <https://www.netflix.com/watch/…>. Same drawer, keyed by Netflix's video id (each episode
   has its own).

The extension defaults to `http://localhost:3131` for both reads and writes. Change the URLs in the toolbar popup.

## Using it

| Action | How |
|---|---|
| Show / hide the drawer, focus the composer | `Shift+C`, or the pill on the right edge |
| Comment on this moment | Type in the composer. The red time chip freezes at the moment you started typing. `Enter` posts, `Esc` cancels. The video pauses while you type and resumes when you post (toggle in popup). |
| Read what people said here | **Live** tab: comments in time order, the ones from the last ~25 s highlighted as *happening now*, auto-scrolls with playback. |
| Best comments | **Top** tab (by likes, then replies). **New** tab is newest first. |
| Spoiler guard | Comments ahead of the playhead are hidden by default. Eye icon in the header or "Show anyway" reveals them. |
| Jump to a moment | Click a comment's time pill, or click the density strip under the header. |
| Likes, replies, delete | On each comment. Replies inherit the parent's timestamp. You can delete only your own. |
| Pop-ups | With the drawer closed (or on Top/New), passing a comment pops a bubble bottom-left for ~6 s. Click it to open the drawer there. |

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

### Deploying on Cloudflare (free / $5 tier) — *written, not yet deployed*

`edge/` contains a Worker that serves the write API from **D1** and a cron that renders dirty titles to **R2**.
Reads go straight to the R2 bucket's public custom domain with Cloudflare's cache in front, so they invoke no
Worker and count against nothing. I could not deploy it from this machine, so treat the steps as a checklist:

```bash
npm i -g wrangler && wrangler login
cd edge
wrangler d1 create netflix-comments                 # paste database_id into wrangler.toml
wrangler d1 execute netflix-comments --remote --file=schema.sql
wrangler r2 bucket create netflix-comments-snapshots
wrangler deploy
```

Then in the Cloudflare dashboard: give the R2 bucket a public custom domain (e.g. `comments-cdn.example.com`),
add a cache rule for it (cache everything, edge TTL ≥ 60 s), and point the extension popup's *read URL* at it
and *write URL* at the Worker's URL. Rough cost at 2M viewers: reads ≈ $0 (CDN hits), writes well inside the
$5/month Workers paid plan unless comment volume is enormous. D1 free tier allows 100k writes/day; above that it's
pennies per million.

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
```

Verified here: 24/24 on Chrome for Testing 148. On Chrome for Testing 155 headless, 23/24: that build refuses to
serve extension files from subdirectories to the service worker (hence `popup.html` lives at the extension root).

## What is **not** verified

* **Netflix itself.** The content script was exercised only on the mock player, which mirrors Netflix's URL shape
  (`/watch/<id>`), a plain `<video>` element and document-level hotkeys. On Netflix, the title selector
  (`[data-uia="video-title"]`, visible only while controls are shown), seeking by setting `video.currentTime`,
  and fullscreen re-parenting are best-effort and untested.
* **Cloudflare deployment** (above).

## Limitations / next steps

* No auth: identities are client-generated and spoofable; the only abuse control is a per-IP rate limit.
  Real accounts (e.g. Cloudflare Access, Turnstile, or OAuth) are the first thing to add before opening it up.
* No moderation or reporting yet.
* Very busy titles: `meta.json` holds only top-100/newest-50 and each 5-minute bucket is one file; a bucket with
  tens of thousands of comments gets large. Next step is paging the bucket file or lowering `BUCKET_SECONDS`.
* Chrome only (Manifest V3). Firefox would need a small manifest change.

## Layout

```
extension/         Chrome extension (MV3): content/ overlay, background.js fetch proxy, popup.html settings
server/            Node dev/self-host server: write API + snapshot renderer + mock player (public/)
server/shared/     routes, SQL, snapshot builder — shared with the Worker
edge/              Cloudflare Worker (D1 + R2 + cron) — unverified
dev/e2e.mjs        end-to-end browser test
```
