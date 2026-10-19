
(() => {
  if (window.__nfcInjected) { document.getElementById('nfc-host')?.remove(); }
  window.__nfcInjected = true;
  const mem = { sync: {}, local: {} };
  const area = (name) => ({
    get: (k, cb) => { const o = {}; const keys = k == null ? Object.keys(mem[name]) : Array.isArray(k) ? k : [k]; for (const key of keys) if (key in mem[name]) o[key] = mem[name][key]; cb(o); },
    set: (obj, cb) => { Object.assign(mem[name], obj); cb && cb(); },
    remove: (k, cb) => { delete mem[name][k]; cb && cb(); },
  });
  window.chrome = window.chrome || {};
  chrome.storage = { sync: area('sync'), local: area('local'), onChanged: { addListener() {} } };
  chrome.runtime = chrome.runtime || {};
  const OFFLINE = true;
  chrome.runtime.sendMessage = (msg, cb) => {
    if (msg.type !== 'fetch') return cb && cb({ error: 'unsupported' });
    if (OFFLINE) return setTimeout(() => cb({ error: 'network: offline shim' }), 50); // https pages can't reach localhost
    fetch(msg.url, { method: msg.method || 'GET', headers: msg.body != null ? { 'Content-Type': 'application/json' } : undefined, body: msg.body != null ? JSON.stringify(msg.body) : undefined })
      .then(async (r) => { const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {} cb({ ok: r.ok, status: r.status, body: j }); })
      .catch((e) => cb({ error: 'network: ' + e.message }));
  };
  if (OFFLINE) {
    // Preload a believable cached snapshot for whatever episode this page is, keyed the way sites.js keys it.
    const raw = (location.pathname.split('/watch/')[1] || 'x').split(/[/?#]/)[0].toLowerCase();
    const vid = /hulu/.test(location.hostname) ? 'hulu-' + raw : /netflix/.test(location.hostname) ? 'nf-' + raw : raw;
    const people = [['mara_k','u_mara0001'],['devon','u_devon001'],['sunny.b','u_sunny001'],['jtroll','u_jtrol001'],['priya','u_priya001'],['kat','u_kat00001']];
    const seed = [[6,'cold open goes hard'],[19,'this intro music though'],[41,'ok who is this guy'],[58,'she is going to regret that'],[75,'HE SAID IT'],[92,'the look on his face'],[110,'no way'],[128,'callback to the pilot'],[150,'this is where it gets good'],[171,'pause here, look at the background'],[200,'absolute cinema'],[240,'did anyone else cry'],[300,'second act slaps'],[420,'ending incoming'],[900,'that twist']];
    const comments = seed.map(([t, body], i) => ({ id: 1000 + i, parentId: null, t, body, authorId: people[i % 6][1], authorName: people[i % 6][0], createdAt: Date.now() - (i + 1) * 3600e3 * 7, likeCount: [8,0,3,0,12,5,0,2,6,1,9,4,0,2,7][i], replyCount: i === 4 ? 1 : 0 }));
    comments.push({ id: 2000, parentId: 1004, t: 75, body: 'he really did', authorId: people[2][1], authorName: people[2][0], createdAt: Date.now() - 3600e3, likeCount: 1, replyCount: 0 });
    const B = 300, HS = 10, duration = 2527;
    const hist = new Array(Math.floor(duration / HS) + 1).fill(0); comments.forEach((c) => { if (c.parentId == null) hist[Math.floor(c.t / HS)]++; });
    const buckets = {}; const bucketCounts = {}; comments.forEach((c) => { const b = Math.floor(c.t / B); (buckets[b] ||= []).push(c); if (c.parentId == null) bucketCounts[b] = (bucketCounts[b] || 0) + 1; });
    const top = comments.filter((c) => c.parentId == null).sort((a, b) => b.likeCount - a.likeCount);
    mem.local['title:' + vid] = { meta: { videoId: vid, name: '', duration, count: top.length, totalWithReplies: comments.length, bucketSeconds: B, bucketCounts, histSeconds: HS, hist, top, newest: [...top].sort((a, b) => b.createdAt - a.createdAt), generatedAt: Date.now() - 60e3 }, buckets, mine: [], likes: {}, deleted: {}, savedAt: Date.now() };
  }
  mem.sync.settings = { readBase: "http://localhost:3131", writeBase: "http://localhost:3131", displayName: 'chad', spoilerGuard: true, showToasts: true, pauseOnCompose: true, panelOpen: true };
})();

// Shared helpers for the content scripts. Everything lives under window.NFC to avoid globals.
window.NFC = window.NFC || {};
(() => {
  const NFC = window.NFC;
  NFC.BUCKET_SECONDS = 300; // must match server/shared/constants.js
  NFC.bucketOf = (t) => Math.floor(t / NFC.BUCKET_SECONDS);

  NFC.fmtTime = (s) => {
    if (!Number.isFinite(s) || s < 0) s = 0;
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const mm = h ? String(m).padStart(2, '0') : String(m);
    return (h ? h + ':' : '') + mm + ':' + String(sec).padStart(2, '0');
  };

  NFC.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  NFC.uuid = () => (crypto.randomUUID ? crypto.randomUUID() : [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join(''));

  NFC.hash = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };
  NFC.avatarColor = (id) => `hsl(${NFC.hash(id) % 360} 55% 45%)`;
  NFC.initial = (name) => (String(name || '?').trim()[0] || '?').toUpperCase();

  NFC.timeAgo = (ts) => {
    const d = Math.max(0, Date.now() - ts) / 1000;
    if (d < 60) return 'just now';
    if (d < 3600) return Math.floor(d / 60) + 'm ago';
    if (d < 86400) return Math.floor(d / 3600) + 'h ago';
    if (d < 86400 * 30) return Math.floor(d / 86400) + 'd ago';
    return Math.floor(d / (86400 * 30)) + 'mo ago';
  };

  NFC.compact = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K' : String(n));

  NFC.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  NFC.storage = {
    get: (area, key, dflt) => new Promise((res) => chrome.storage[area].get(key, (o) => res(o[key] === undefined ? dflt : o[key]))),
    set: (area, key, val) => new Promise((res) => chrome.storage[area].set({ [key]: val }, res)),
    remove: (area, key) => new Promise((res) => chrome.storage[area].remove(key, res)),
  };

  // HTTP via the background service worker. Resolves {ok, status, body} or {error}.
  NFC.http = (url, method = 'GET', body) => new Promise((res) => {
    try {
      chrome.runtime.sendMessage({ type: 'fetch', url, method, body }, (r) => {
        if (chrome.runtime.lastError) return res({ error: chrome.runtime.lastError.message });
        res(r || { error: 'no response' });
      });
    } catch (e) { res({ error: String(e) }); }
  });

  NFC.log = (...a) => console.debug('[nfc]', ...a);
})();

// Per-site adapters. Everything site-specific lives here: which pages are player pages, how to derive a
// stable id for the episode/movie (namespaced so Netflix and Hulu ids never collide), and where the title is.
window.NFC = window.NFC || {};
(() => {
  const NFC = window.NFC;
  const textOf = (el) => {
    if (!el) return '';
    const parts = [...el.querySelectorAll('h1, h2, h3, h4, span, div, p')].map((n) => (n.children.length ? '' : n.textContent.trim())).filter(Boolean);
    return (parts.length ? parts.join(' ') : el.textContent).replace(/\s+/g, ' ').trim().slice(0, 200);
  };
  const firstText = (selectors) => { for (const s of selectors) { const t = textOf(document.querySelector(s)); if (t) return t; } return ''; };

  // Default clock/seek: the <video> element is the source of truth.
  const defaultClock = (v) => ({ now: v.currentTime || 0, duration: Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null });
  const defaultSeek = (v, t) => { v.currentTime = t; };

  // Hulu stitches ad breaks into the content stream, so video.currentTime runs ahead of the content position by
  // the length of the ads already played. Hulu's own timeline slider (aria-valuenow/max, in seconds) is the
  // content clock; we read it every tick and remember the offset for seeking and for moments it isn't present.
  let huluOffset = 0, huluDuration = null;
  const huluClock = (v) => {
    const s = document.querySelector('.Timeline__slider[aria-valuenow]');
    if (s) {
      const now = Number(s.getAttribute('aria-valuenow')), max = Number(s.getAttribute('aria-valuemax'));
      if (Number.isFinite(now)) {
        huluOffset = v.currentTime - now;
        if (Number.isFinite(max) && max > 0) huluDuration = max;
        // sub-second smoothing: slider is integer seconds, so add the fractional part of the video clock
        const frac = Math.max(0, Math.min(0.999, (v.currentTime - huluOffset) - now));
        return { now: now + frac, duration: huluDuration };
      }
    }
    return { now: Math.max(0, v.currentTime - huluOffset), duration: huluDuration };
  };
  const huluSeek = (v, t) => { v.currentTime = t + huluOffset; };

  NFC.SITES = [
    {
      name: 'netflix',
      test: (h) => /(^|\.)netflix\.com$/.test(h),
      videoId: (loc) => { const m = loc.pathname.match(/^\/watch\/(\d+)/); return m ? 'nf-' + m[1] : null; },
      title: () => firstText(['[data-uia="video-title"]', '.watch-video--title-text', '[data-uia="player-title"]']),
      video: () => document.querySelector('video'),
      clock: defaultClock, seek: defaultSeek,
      mount: () => document.body,
    },
    {
      name: 'hulu',
      test: (h) => /(^|\.)hulu\.com$/.test(h),
      // https://www.hulu.com/watch/<uuid>
      videoId: (loc) => { const m = loc.pathname.match(/^\/watch\/([0-9a-f-]{8,})/i); return m ? 'hulu-' + m[1].toLowerCase() : null; },
      // Verified against the live player 2026-10-18: "9-1-1: Nashville" + "S1 E1-Pilot•TV14"
      title: () => {
        const t = textOf(document.querySelector('.PlayerMetadata__titleText, .PlayerMetadata__title'));
        const sub = textOf(document.querySelector('.PlayerMetadata__subTitle')).replace(/•.*$/, '').replace(/^(S\d+ E\d+)-/, '$1 ').trim();
        return [t, sub].filter(Boolean).join(' · ');
      },
      // #content-video-player is the show; #ad-video-player / #intro-video-player / .VideoPreviewPlayer are not.
      video: () => document.getElementById('content-video-player') || document.querySelector('video.ContentPlayer__videoPlayer') || document.querySelector('video'),
      clock: huluClock, seek: huluSeek,
      // Hulu's player keeps a focus trap: focus outside .ContentPlayer snaps back to a player button, so the
      // overlay must live inside it (verified live 2026-10-18).
      mount: () => document.querySelector('.ContentPlayer') || document.getElementById('web-player-app') || document.body,
    },
    {
      name: 'mock',
      test: (h) => h === 'localhost' || h === '127.0.0.1',
      videoId: (loc) => { const m = loc.pathname.match(/^\/watch\/([^/?#]+)/); return m ? m[1] : null; },
      title: () => firstText(['[data-uia="video-title"]']),
      video: () => document.querySelector('video'),
      clock: defaultClock, seek: defaultSeek,
      mount: () => document.body,
    },
  ];
  NFC.site = NFC.SITES.find((s) => s.test(location.hostname)) || null;
})();

// Styles injected into the shadow root (content_scripts CSS can't reach inside a shadow DOM).
window.NFC = window.NFC || {};
window.NFC.CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #f2f2f2; --red: #e50914; --bg: rgba(18,18,20,.92); --bg2: rgba(255,255,255,.06); --bg3: rgba(255,255,255,.11); --line: rgba(255,255,255,.10); --muted: #9a9a9a; }
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; padding: 0; }
button:focus-visible, textarea:focus-visible { outline: 2px solid var(--red); outline-offset: 1px; }

/* toggle pill (drawer closed) */
.pill { pointer-events: auto; position: absolute; right: 0; top: 45%; transform: translateY(-50%); background: var(--bg); backdrop-filter: blur(14px); border: 1px solid var(--line); border-right: 0; border-radius: 14px 0 0 14px; padding: 10px 12px 10px 14px; display: flex; flex-direction: column; align-items: center; gap: 4px; box-shadow: 0 6px 24px rgba(0,0,0,.4); transition: background .15s; }
.pill:hover { background: rgba(30,30,34,.96); }
.pill .n { font-weight: 700; font-size: 13px; }
.pill .ic { width: 22px; height: 22px; fill: #fff; }
.pill .live { position: absolute; top: -6px; left: -6px; background: var(--red); color: #fff; font-size: 10px; font-weight: 700; border-radius: 10px; padding: 1px 6px; display: none; }
.pill .live.on { display: block; }

/* drawer */
.drawer { pointer-events: auto; position: absolute; top: 12px; right: 12px; bottom: 92px; width: 380px; max-width: calc(100vw - 24px); display: flex; flex-direction: column; background: var(--bg); backdrop-filter: blur(18px); border: 1px solid var(--line); border-radius: 16px; box-shadow: 0 12px 48px rgba(0,0,0,.55); overflow: hidden; }
.hdr { display: flex; align-items: center; gap: 8px; padding: 12px 12px 8px 16px; }
.hdr .ttl { flex: 1; min-width: 0; }
.hdr .name { font-weight: 700; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hdr .sub { color: var(--muted); font-size: 12px; margin-top: 1px; }
.hdr .sub .warn { color: #ffb74d; }
.ib { width: 32px; height: 32px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; color: #ddd; }
.ib:hover { background: var(--bg3); }
.ib svg { width: 18px; height: 18px; fill: currentColor; }
.ib.on { color: var(--red); }

/* timeline strip (SoundCloud-ish) */
.strip { position: relative; margin: 2px 16px 6px; height: 44px; cursor: pointer; }
.hist { position: absolute; inset: 0; display: flex; align-items: flex-end; gap: 1px; }
.hist i { flex: 1; min-width: 1px; background: rgba(255,255,255,.22); border-radius: 1px 1px 0 0; height: 2px; transition: background .2s; }
.hist i.past { background: rgba(229,9,20,.75); }
.hist i.hot { background: #fff; }
.play { position: absolute; top: -2px; bottom: -2px; width: 2px; background: #fff; box-shadow: 0 0 6px #fff; left: 0; }
.play::after { content: ''; position: absolute; top: -4px; left: -4px; width: 10px; height: 10px; border-radius: 50%; background: #fff; }
.strip .tt { position: absolute; top: -26px; transform: translateX(-50%); background: #fff; color: #000; font-size: 11px; font-weight: 600; padding: 2px 6px; border-radius: 6px; white-space: nowrap; display: none; }
.strip:hover .tt { display: block; }
.times { display: flex; justify-content: space-between; margin: 0 16px 4px; font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }

/* tabs */
.tabs { display: flex; gap: 4px; padding: 4px 12px 0; border-bottom: 1px solid var(--line); }
.tab { padding: 8px 12px; color: var(--muted); font-weight: 600; border-bottom: 2px solid transparent; margin-bottom: -1px; border-radius: 6px 6px 0 0; }
.tab:hover { color: #fff; background: var(--bg2); }
.tab.on { color: #fff; border-bottom-color: var(--red); }
.tab .c { color: var(--muted); font-weight: 500; margin-left: 4px; font-size: 12px; }

/* list */
.list { flex: 1; overflow-y: auto; padding: 6px 8px 8px; scroll-behavior: smooth; }
.list::-webkit-scrollbar { width: 8px; } .list::-webkit-scrollbar-thumb { background: rgba(255,255,255,.18); border-radius: 4px; }
.empty { color: var(--muted); text-align: center; padding: 36px 16px; line-height: 1.6; }
.empty b { color: #fff; }
.cm { display: flex; gap: 10px; padding: 10px 8px; border-radius: 12px; transition: background .25s; position: relative; }
.cm:hover { background: var(--bg2); }
.cm.now { background: rgba(229,9,20,.14); }
.cm.now::before { content: ''; position: absolute; left: 0; top: 10px; bottom: 10px; width: 3px; border-radius: 2px; background: var(--red); }
.cm.pending { opacity: .6; }
.cm.failed .meta { color: #ff6b6b; }
.cm.reply { padding-left: 46px; }
.av { width: 34px; height: 34px; border-radius: 50%; flex: none; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; color: #fff; }
.cm.reply .av { width: 26px; height: 26px; font-size: 11px; }
.bd { flex: 1; min-width: 0; }
.meta { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); flex-wrap: wrap; }
.meta .who { color: #fff; font-weight: 600; }
.meta .age { color: #777; }
.meta .you { background: var(--bg3); color: #fff; font-size: 10px; padding: 0 5px; border-radius: 4px; font-weight: 600; }
.tpill { background: var(--bg3); color: #fff; font-variant-numeric: tabular-nums; font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 10px; }
.tpill:hover { background: var(--red); }
.txt { margin-top: 3px; white-space: pre-wrap; word-wrap: break-word; font-size: 14px; }
.acts { display: flex; align-items: center; gap: 14px; margin-top: 6px; font-size: 12px; color: var(--muted); }
.acts button:hover { color: #fff; }
.like { display: inline-flex; align-items: center; gap: 4px; }
.like svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; }
.like.on { color: var(--red); } .like.on svg { fill: var(--red); stroke: var(--red); }
.hidden-row { margin: 6px 8px; padding: 10px 12px; border-radius: 10px; background: var(--bg2); color: var(--muted); font-size: 12px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.hidden-row button { color: #fff; font-weight: 600; }
.divider { text-align: center; color: var(--muted); font-size: 11px; margin: 8px 0 2px; letter-spacing: .04em; text-transform: uppercase; }

/* composer */
.comp { border-top: 1px solid var(--line); padding: 10px 12px 12px; background: rgba(0,0,0,.25); }
.comp .row1 { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 12px; color: var(--muted); }
.comp .at { background: var(--red); color: #fff; font-weight: 700; padding: 2px 9px; border-radius: 10px; font-variant-numeric: tabular-nums; }
.comp .replyto { flex: 1; display: flex; align-items: center; gap: 6px; }
.comp .replyto button { color: #fff; }
.comp .box { display: flex; gap: 8px; align-items: flex-end; }
textarea { flex: 1; resize: none; min-height: 40px; max-height: 120px; background: var(--bg3); border: 1px solid transparent; border-radius: 12px; color: #fff; padding: 10px 12px; font: inherit; }
textarea::placeholder { color: var(--muted); }
textarea:focus { border-color: rgba(255,255,255,.3); }
.send { background: var(--red); color: #fff; font-weight: 700; border-radius: 10px; padding: 0 14px; height: 40px; }
.send:disabled { opacity: .4; cursor: default; }
.hint { font-size: 11px; color: var(--muted); margin-top: 6px; }
kbd { background: var(--bg3); border-radius: 4px; padding: 0 5px; font: 11px ui-monospace, Menlo, monospace; }

/* toasts (SoundCloud-style passing comments) */
.toasts { position: absolute; left: 24px; bottom: 130px; display: flex; flex-direction: column; gap: 8px; max-width: min(360px, 36vw); }
.toast { pointer-events: auto; display: flex; gap: 10px; align-items: flex-start; background: var(--bg); backdrop-filter: blur(14px); border: 1px solid var(--line); border-radius: 14px; padding: 10px 12px; box-shadow: 0 8px 28px rgba(0,0,0,.45); animation: pop .25s ease-out; cursor: pointer; }
.toast.out { animation: fade .4s ease-in forwards; }
.toast .pin { font-size: 10px; color: var(--muted); margin-top: 3px; }
.toast .av { width: 28px; height: 28px; font-size: 12px; }
.toast .who { font-size: 12px; color: var(--muted); }
.toast .who b { color: #fff; }
.toast .txt { margin-top: 1px; font-size: 14px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
@keyframes pop { from { transform: translateY(12px) scale(.96); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes fade { to { opacity: 0; transform: translateY(-8px); } }
.hide { display: none !important; }
`;

// Data layer. Designed for availability over consistency:
//  - reads come from CDN-cacheable snapshots (meta.json + 5-minute bucket files) and are cached locally
//  - your own posts/likes are applied locally first and merged over whatever snapshot we have
//  - writes go through an outbox that retries, so the drawer keeps working if the server is unreachable
(() => {
  const NFC = window.NFC;
  const S = NFC.storage;

  const DEFAULT_SETTINGS = {
    displayName: '',
    readBase: 'http://localhost:3131',
    writeBase: 'http://localhost:3131',
    spoilerGuard: true,
    showToasts: true,
    pauseOnCompose: true,
    panelOpen: true,
  };
  const META_TTL = 45_000, BUCKET_TTL = 60_000, MINE_TTL = 15 * 60_000, CACHE_TITLES = 25;

  const store = NFC.store = {
    settings: { ...DEFAULT_SETTINGS },
    user: null,
    listeners: new Set(),
    onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
    emit(what) { for (const fn of this.listeners) try { fn(what); } catch (e) { console.error(e); } },

    async init() {
      const saved = await S.get('sync', 'settings', {});
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
      let user = await S.get('local', 'user', null);
      if (!user?.userId) {
        user = { userId: 'u_' + NFC.uuid().replace(/-/g, '').slice(0, 24), createdAt: Date.now() };
        await S.set('local', 'user', user);
      }
      this.user = user;
      if (!this.settings.displayName) {
        this.settings.displayName = 'viewer-' + user.userId.slice(2, 6);
        await S.set('sync', 'settings', this.settings);
      }
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && changes.settings) {
          this.settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
          this.emit('settings');
        }
      });
      setInterval(() => outbox.flush(), 10_000);
      outbox.flush();
    },

    async saveSettings(patch) {
      this.settings = { ...this.settings, ...patch };
      await S.set('sync', 'settings', this.settings);
    },

    displayName() { return this.settings.displayName || 'viewer'; },
    readUrl(path) { return this.settings.readBase.replace(/\/+$/, '') + '/' + path; },
    writeUrl(path) { return this.settings.writeBase.replace(/\/+$/, '') + path; },
  };

  // ---------- per-title state ----------
  class TitleState {
    constructor(videoId) {
      this.videoId = videoId;
      this.meta = null;
      this.metaAt = 0;
      this.buckets = new Map();   // bucket -> { comments, at }
      this.loading = new Set();
      this.mine = [];             // comments I authored recently (pending or acked), always merged in
      this.likes = {};            // id -> { liked, at }
      this.deleted = {};          // id -> at
      this.name = '';
      this.duration = null;
      this.reported = false;
      this.offline = false;
    }

    key() { return 'title:' + this.videoId; }

    async loadCached() {
      const c = await S.get('local', this.key(), null);
      if (!c) return;
      this.meta = c.meta ?? null;
      this.metaAt = 0; // cached meta is stale by definition; refetch soon
      for (const [b, comments] of Object.entries(c.buckets ?? {})) this.buckets.set(Number(b), { comments, at: 0 });
      this.mine = (c.mine ?? []).filter((m) => m.pending || Date.now() - m.createdAt < MINE_TTL);
      this.likes = c.likes ?? {};
      this.deleted = c.deleted ?? {};
    }

    save = NFC.debounce(async () => {
      const buckets = {};
      for (const [b, v] of this.buckets) buckets[b] = v.comments;
      await S.set('local', this.key(), { meta: this.meta, buckets, mine: this.mine, likes: this.likes, deleted: this.deleted, savedAt: Date.now() });
      pruneCache();
    }, 500);

    async fetchMeta(force = false) {
      if (!force && Date.now() - this.metaAt < META_TTL) return;
      if (this.loading.has('meta')) return;
      this.loading.add('meta');
      try {
        const r = await NFC.http(store.readUrl(`t/${this.videoId}/meta.json`));
        if (r.ok) { this.meta = r.body; this.offline = false; }
        else if (r.status === 404) { this.offline = false; if (!this.meta) this.meta = emptyMeta(this.videoId); }
        else this.offline = !!r.error;
        if (!r.error) this.metaAt = Date.now();
        this.save();
        store.emit('data');
      } finally { this.loading.delete('meta'); }
    }

    async ensureBucket(b, force = false) {
      if (b < 0) return;
      const cur = this.buckets.get(b);
      if (!force && cur && Date.now() - cur.at < BUCKET_TTL) return;
      if (this.loading.has(b)) return;
      // Skip buckets the meta says are empty (saves a request); still honor local pending comments.
      if (this.meta && this.metaAt && !this.meta.bucketCounts?.[b] && !cur) {
        this.buckets.set(b, { comments: [], at: Date.now() });
        return;
      }
      this.loading.add(b);
      try {
        const r = await NFC.http(store.readUrl(`t/${this.videoId}/b/${b}.json`));
        if (r.ok) { this.buckets.set(b, { comments: r.body.comments ?? [], at: Date.now() }); this.offline = false; }
        else if (r.status === 404) this.buckets.set(b, { comments: [], at: Date.now() });
        else this.offline = !!r.error;
        this.save();
        store.emit('data');
      } finally { this.loading.delete(b); }
    }

    /** Merged, de-duplicated view with local overlays applied. */
    all() {
      const byId = new Map();
      const put = (c) => { if (!byId.has(c.id)) byId.set(c.id, { ...c }); };
      for (const v of this.buckets.values()) v.comments.forEach(put);
      (this.meta?.top ?? []).forEach(put);
      (this.meta?.newest ?? []).forEach(put);
      const gen = this.meta?.generatedAt ?? 0;
      for (const m of this.mine) {
        if (!byId.has(m.id)) byId.set(m.id, { ...m, mine: true });
        else byId.get(m.id).mine = true;
      }
      const out = [];
      for (const c of byId.values()) {
        if (this.deleted[c.id]) continue;
        if (c.authorId === store.user.userId) c.mine = true;
        const lk = this.likes[c.id];
        if (lk) {
          c.liked = lk.liked;
          if (lk.at > gen) c.likeCount = Math.max(0, (c.likeCount ?? 0) + (lk.liked ? 1 : -1)); // snapshot predates my action
        }
        out.push(c);
      }
      // reply counts: trust snapshot, but add local pending replies
      const extra = {};
      for (const m of this.mine) if (m.parentId != null && (m.pending || m.createdAt > gen)) extra[m.parentId] = (extra[m.parentId] ?? 0) + 1;
      for (const c of out) if (extra[c.id]) c.replyCount = (c.replyCount ?? 0) + extra[c.id];
      return out;
    }

    // ---- writes (optimistic) ----
    post(t, body, parentId = null) {
      const c = {
        id: 'local-' + NFC.uuid(), parentId, t, body,
        authorId: store.user.userId, authorName: store.displayName(),
        createdAt: Date.now(), likeCount: 0, replyCount: 0, pending: true, mine: true,
      };
      this.mine.push(c);
      this.save();
      outbox.push({ kind: 'comment', videoId: this.videoId, tempId: c.id, payload: { t, body, parentId, authorId: c.authorId, authorName: c.authorName } });
      store.emit('data');
      return c;
    }

    toggleLike(id) {
      if (String(id).startsWith('local-')) return;
      const cur = this.likes[id]?.liked ?? false;
      this.likes[id] = { liked: !cur, at: Date.now() };
      this.save();
      outbox.push({ kind: 'like', videoId: this.videoId, payload: { id, userId: store.user.userId } });
      store.emit('data');
    }

    remove(id) {
      this.deleted[id] = Date.now();
      this.mine = this.mine.filter((m) => m.id !== id);
      this.save();
      if (!String(id).startsWith('local-')) outbox.push({ kind: 'delete', videoId: this.videoId, payload: { id, userId: store.user.userId } });
      else outbox.drop((op) => op.tempId === id);
      store.emit('data');
    }

    ack(tempId, serverComment) {
      const i = this.mine.findIndex((m) => m.id === tempId);
      if (i >= 0) this.mine[i] = { ...serverComment, mine: true };
      this.save();
      store.emit('data');
    }

    fail(tempId, error) {
      const m = this.mine.find((x) => x.id === tempId);
      if (m) { m.pending = false; m.failed = error; }
      this.save();
      store.emit('data');
    }

    async reportTitle(name, duration) {
      if (this.reported) return;
      if (!name && !duration) return;
      this.reported = true;
      this.name = name; this.duration = duration;
      outbox.push({ kind: 'title', videoId: this.videoId, payload: { name, duration } });
    }
  }

  function emptyMeta(videoId) {
    return { videoId, name: '', duration: null, count: 0, totalWithReplies: 0, bucketSeconds: NFC.BUCKET_SECONDS, bucketCounts: {}, histSeconds: 10, hist: [], top: [], newest: [], generatedAt: 0 };
  }

  async function pruneCache() {
    const all = await new Promise((r) => chrome.storage.local.get(null, r));
    const titles = Object.entries(all).filter(([k]) => k.startsWith('title:')).sort((a, b) => (b[1].savedAt ?? 0) - (a[1].savedAt ?? 0));
    for (const [k] of titles.slice(CACHE_TITLES)) chrome.storage.local.remove(k);
  }

  store.current = null;
  store.loadTitle = async (videoId) => {
    if (store.current?.videoId === videoId) return store.current;
    const ts = new TitleState(videoId);
    await ts.loadCached();
    store.current = ts;
    store.emit('title');
    ts.fetchMeta(true);
    return ts;
  };

  // ---------- outbox ----------
  const outbox = store.outbox = {
    busy: false,
    async list() { return S.get('local', 'outbox', []); },
    async push(op) {
      const ops = await this.list();
      ops.push({ ...op, id: NFC.uuid(), createdAt: Date.now(), attempts: 0 });
      await S.set('local', 'outbox', ops);
      this.flush();
    },
    async drop(pred) {
      const ops = await this.list();
      await S.set('local', 'outbox', ops.filter((op) => !pred(op)));
    },
    async flush() {
      if (this.busy) return;
      this.busy = true;
      try {
        let ops = await this.list();
        const keep = [];
        for (const op of ops) {
          const done = await this.send(op);
          if (!done) keep.push(op);
        }
        await S.set('local', 'outbox', keep);
        store.emit('outbox', keep.length);
      } finally { this.busy = false; }
    },
    /** returns true when the op is finished (success or permanently failed) */
    async send(op) {
      const cur = store.current?.videoId === op.videoId ? store.current : null;
      op.attempts++;
      let r;
      if (op.kind === 'comment') {
        // a reply to a comment that is itself still pending can't be sent yet
        if (op.payload.parentId != null && String(op.payload.parentId).startsWith('local-')) {
          const parent = cur?.mine.find((m) => m.id === op.payload.parentId);
          return !parent && op.attempts > 30; // give up only after the parent is long gone
        }
        r = await NFC.http(store.writeUrl(`/api/titles/${op.videoId}/comments`), 'POST', op.payload);
        if (r.ok) { cur ? cur.ack(op.tempId, r.body) : ackInStorage(op.videoId, op.tempId, r.body); return true; }
      } else if (op.kind === 'like') {
        r = await NFC.http(store.writeUrl(`/api/comments/${op.payload.id}/like`), 'POST', { userId: op.payload.userId });
        if (r.ok && cur) {
          // server tells us the real state; reconcile our optimistic toggle
          const lk = cur.likes[op.payload.id];
          if (lk && lk.liked !== r.body.liked) { cur.likes[op.payload.id] = { liked: r.body.liked, at: Date.now() }; cur.save(); store.emit('data'); }
        }
        if (r.ok) return true;
      } else if (op.kind === 'delete') {
        r = await NFC.http(store.writeUrl(`/api/comments/${op.payload.id}?user=${encodeURIComponent(op.payload.userId)}`), 'DELETE');
        if (r.ok || r.status === 404) return true;
      } else if (op.kind === 'title') {
        r = await NFC.http(store.writeUrl(`/api/titles/${op.videoId}`), 'PUT', op.payload);
        if (r.ok) return true;
      }
      if (r?.error) { if (cur) { cur.offline = true; store.emit('data'); } return false; } // network/permission: retry later
      if (r && r.status >= 400 && r.status !== 429 && r.status < 500) {
        if (op.kind === 'comment') cur ? cur.fail(op.tempId, r.body?.error || `rejected (${r.status})`) : null;
        return true; // permanent rejection
      }
      return op.attempts > 50; // 5xx/429: retry, but not forever
    },
  };

  async function ackInStorage(videoId, tempId, serverComment) {
    const key = 'title:' + videoId;
    const c = await S.get('local', key, null);
    if (!c) return;
    c.mine = (c.mine ?? []).map((m) => (m.id === tempId ? { ...serverComment, mine: true } : m));
    await S.set('local', key, c);
  }
})();

// Shadow-DOM overlay: toggle pill, right-hand drawer (timeline strip, Live/Top/New tabs, composer),
// and floating toasts for comments the playhead passes.
(() => {
  const NFC = window.NFC;
  const { esc, fmtTime, timeAgo, compact, avatarColor, initial } = NFC;
  const store = NFC.store;

  const ICON = {
    chat: '<svg viewBox="0 0 24 24"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path d="M12 5c5 0 9 4 10.5 7-1.5 3-5.5 7-10.5 7S3 15 1.5 12C3 9 7 5 12 5zm0 3.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24"><path d="M2.3 3.7 3.7 2.3l18 18-1.4 1.4-3.3-3.3C15.5 19.3 13.8 19.7 12 19.7 7 19.7 3 15.7 1.5 12.7c.8-1.6 2.2-3.4 4-4.9zM12 5.3c5 0 9 4 10.5 7.4-.6 1.2-1.5 2.5-2.7 3.7l-2.6-2.6a3.8 3.8 0 0 0-4.5-4.5L9.9 6.5c.7-.8 1.4-1.2 2.1-1.2z"/></svg>',
    heart: '<svg viewBox="0 0 24 24"><path d="M12 20.3 4.3 12.6a4.6 4.6 0 0 1 6.5-6.5L12 7.3l1.2-1.2a4.6 4.6 0 0 1 6.5 6.5z"/></svg>',
  };
  const NOW_WINDOW = 12;     // seconds after a comment's t that it counts as "happening now"
  const SPOILER_GRACE = 3;   // seconds ahead of the playhead still shown
  const TOAST_MS = 6000, MAX_TOASTS = 3;

  class UI {
    constructor() {
      this.host = document.createElement('div');
      this.host.id = 'nfc-host';
      this.host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483000;pointer-events:none;';
      this.sh = this.host.attachShadow({ mode: 'open' });
      const style = document.createElement('style'); style.textContent = NFC.CSS; this.sh.appendChild(style);
      this.root = document.createElement('div'); this.root.className = 'root'; this.sh.appendChild(this.root);
      this.root.innerHTML = this.skeleton();
      this.$ = (sel) => this.root.querySelector(sel);
      this.el = {
        pill: this.$('.pill'), pillN: this.$('.pill .n'), pillLive: this.$('.pill .live'),
        drawer: this.$('.drawer'), name: this.$('.name'), sub: this.$('.sub'),
        spoiler: this.$('.spoiler'), strip: this.$('.strip'), hist: this.$('.hist'), play: this.$('.play'), tt: this.$('.tt'),
        tNow: this.$('.t-now'), tEnd: this.$('.t-end'), tabs: this.$('.tabs'), list: this.$('.list'),
        at: this.$('.at'), replyto: this.$('.replyto'), ta: this.$('textarea'), send: this.$('.send'), toasts: this.$('.toasts'),
      };
      this.tab = 'live';
      this.title = null;
      this.video = null;
      this.now = 0; this.duration = 0;
      this.composeT = null;          // frozen timestamp while composing
      this.replyTo = null;           // comment being replied to
      this.expanded = new Set();     // comment ids with replies shown
      this.showAhead = false;        // spoiler guard override for this title
      this.userScrolledAt = 0;
      this.toasted = new Set();
      this.lastSig = '';
      this.pausedByUs = false;
      this.bind();
      this.applySettings();
      this.mount();
    }

    skeleton() {
      return `
<button class="pill" title="Show comments (Shift+C)">${ICON.chat.replace('<svg', '<svg class="ic"')}<span class="n">0</span><span class="live">LIVE</span></button>
<div class="drawer">
  <div class="hdr">
    <div class="ttl"><div class="name">Stream Comments</div><div class="sub">loading…</div></div>
    <button class="ib spoiler on" title="Spoiler guard: hiding comments ahead of you">${ICON.eye}</button>
    <button class="ib close" title="Hide (Shift+C)">${ICON.close}</button>
  </div>
  <div class="strip" title="Comment density. Click to seek."><div class="hist"></div><div class="play"></div><div class="tt">0:00</div></div>
  <div class="times"><span class="t-now">0:00</span><span class="t-end">0:00</span></div>
  <div class="tabs">
    <button class="tab on" data-tab="live">Live</button>
    <button class="tab" data-tab="top">Top</button>
    <button class="tab" data-tab="new">New</button>
  </div>
  <div class="list"></div>
  <div class="comp">
    <div class="row1"><span class="at">0:00</span><span class="replyto"></span><span class="who-am-i"></span></div>
    <div class="box"><textarea rows="1" placeholder="Say something about this moment…" maxlength="1000"></textarea><button class="send" disabled>Post</button></div>
    <div class="hint"><kbd>Shift</kbd>+<kbd>C</kbd> toggle · <kbd>Enter</kbd> post · <kbd>Esc</kbd> cancel</div>
  </div>
</div>
<div class="toasts"></div>`;
    }

    mount() {
      const parent = document.fullscreenElement || (NFC.site && NFC.site.mount && NFC.site.mount()) || document.body;
      if (this.host.parentNode !== parent) parent.appendChild(this.host);
    }

    bind() {
      // Keep keystrokes inside the overlay away from Netflix's player hotkeys (space, arrows, F, M…).
      for (const type of ['keydown', 'keyup', 'keypress']) this.host.addEventListener(type, (e) => e.stopPropagation());
      // Likewise pointer events: players (Hulu) have document-level click handlers that refocus the player.
      for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend', 'focusin', 'focusout']) this.host.addEventListener(type, (e) => e.stopPropagation());

      this.el.pill.addEventListener('click', () => this.setOpen(true));
      this.$('.close').addEventListener('click', () => this.setOpen(false));
      this.el.spoiler.addEventListener('click', () => { this.showAhead = !this.showAhead; this.renderSpoilerBtn(); this.renderList(true); });
      this.el.tabs.addEventListener('click', (e) => {
        const b = e.target.closest('.tab'); if (!b) return;
        this.tab = b.dataset.tab;
        for (const t of this.el.tabs.querySelectorAll('.tab')) t.classList.toggle('on', t === b);
        this.renderList(true);
        this.el.list.scrollTop = 0;
      });
      this.el.strip.addEventListener('mousemove', (e) => {
        const r = this.el.strip.getBoundingClientRect();
        const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        this.el.tt.style.left = (f * 100) + '%'; this.el.tt.textContent = fmtTime(f * this.duration);
      });
      this.el.strip.addEventListener('click', (e) => {
        const r = this.el.strip.getBoundingClientRect();
        this.seek(((e.clientX - r.left) / r.width) * this.duration);
      });
      for (const t of ['wheel', 'touchmove', 'mousedown']) this.el.list.addEventListener(t, () => { this.userScrolledAt = Date.now(); }, { passive: true });
      this.el.list.addEventListener('click', (e) => this.onListClick(e));
      this.el.toasts.addEventListener('click', (e) => {
        const t = e.target.closest('.toast'); if (!t) return;
        this.setOpen(true); this.tab = 'live'; this.renderList(true);
        this.scrollTo(t.dataset.id);
      });

      const ta = this.el.ta;
      // Start composing on focus, first keystroke or click: whichever comes first freezes the timestamp.
      ta.addEventListener('focus', () => this.beginCompose());
      ta.addEventListener('mousedown', () => this.beginCompose());
      ta.addEventListener('input', () => {
        if (this.composeT == null) this.beginCompose();
        this.el.send.disabled = !ta.value.trim();
        ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px';
      });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.submit(); }
        if (e.key === 'Escape') { e.preventDefault(); this.cancelCompose(); }
      });
      this.el.send.addEventListener('click', () => this.submit());
      this.el.replyto.addEventListener('click', (e) => { if (e.target.closest('button')) this.setReply(null); });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'C' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e)) {
          e.preventDefault(); e.stopPropagation();
          if (!this.open) { this.setOpen(true); this.el.ta.focus(); }
          else if (this.sh.activeElement === this.el.ta) this.setOpen(false);
          else this.el.ta.focus();
        }
      }, true);
      document.addEventListener('fullscreenchange', () => this.mount());

      store.onChange((what) => {
        if (what === 'settings') this.applySettings();
        if (what === 'data' || what === 'title' || what === 'outbox') { this.renderHeader(); this.renderStrip(); this.renderList(); }
      });
    }

    // ---------- state ----------
    get open() { return !this.el.drawer.classList.contains('hide'); }
    setOpen(v) {
      this.el.drawer.classList.toggle('hide', !v);
      this.el.pill.classList.toggle('hide', v);
      store.saveSettings({ panelOpen: v });
      if (v) this.renderList(true);
    }
    applySettings() {
      const s = store.settings;
      this.$('.who-am-i').textContent = 'as ' + store.displayName();
      if (this.el.drawer.classList.contains('hide') === !!s.panelOpen) {
        this.el.drawer.classList.toggle('hide', !s.panelOpen);
        this.el.pill.classList.toggle('hide', !!s.panelOpen);
      }
      this.renderSpoilerBtn();
      this.renderList(true);
    }
    spoilerOn() { return store.settings.spoilerGuard && !this.showAhead; }
    renderSpoilerBtn() {
      const on = this.spoilerOn();
      this.el.spoiler.classList.toggle('on', on);
      this.el.spoiler.innerHTML = on ? ICON.eye : ICON.eyeOff;
      this.el.spoiler.title = on ? 'Spoiler guard ON: comments ahead of you are hidden. Click to show them.' : 'Spoiler guard OFF: showing comments ahead of you. Click to hide them.';
    }

    setTitle(title, video) {
      this.title = title; this.video = video;
      this.expanded.clear(); this.toasted.clear(); this.showAhead = false; this.lastSig = '';
      this.setReply(null);
      this.renderSpoilerBtn(); this.renderHeader(); this.renderStrip(); this.renderList(true);
    }
    setVideo(video) { this.video = video; }

    /** called on every timeupdate */
    tick(now, duration) {
      this.now = now;
      if (Number.isFinite(duration) && duration > 0) this.duration = duration;
      else if (this.title?.meta?.duration) this.duration = this.title.meta.duration;
      this.el.tNow.textContent = fmtTime(now); this.el.tEnd.textContent = fmtTime(this.duration);
      if (this.duration) this.el.play.style.left = Math.min(100, (now / this.duration) * 100) + '%';
      if (this.composeT == null) this.el.at.textContent = fmtTime(now);
      this.renderStripProgress();
      this.renderList();
      this.maybeToast();
      this.el.pillLive.classList.toggle('on', this.visible().some((c) => c.parentId == null && now - c.t >= 0 && now - c.t < NOW_WINDOW));
    }

    seek(t) {
      if (!this.video || !Number.isFinite(t)) return;
      try { NFC.site.seek(this.video, Math.max(0, Math.min(this.duration || t, t))); } catch (e) { NFC.log('seek failed', e); }
    }

    // ---------- data views ----------
    visible() {
      if (!this.title) return [];
      const all = this.title.all();
      if (!this.spoilerOn()) return all;
      return all.filter((c) => c.t <= this.now + SPOILER_GRACE || c.pending);
    }
    hiddenCount() {
      if (!this.title || !this.spoilerOn()) return 0;
      return this.title.all().filter((c) => c.parentId == null && c.t > this.now + SPOILER_GRACE && !c.pending).length;
    }

    // ---------- rendering ----------
    renderHeader() {
      const t = this.title; if (!t) return;
      const m = t.meta;
      this.el.name.textContent = m?.name || t.name || `Title ${t.videoId}`;
      const parts = [];
      parts.push(`${compact(m?.count ?? 0)} comment${(m?.count ?? 0) === 1 ? '' : 's'}`);
      if (t.offline) parts.push('<span class="warn">offline · showing cached</span>');
      else if (m?.generatedAt) parts.push(`synced ${timeAgo(m.generatedAt)}`);
      this.el.sub.innerHTML = parts.join(' · ');
      this.el.pillN.textContent = compact(m?.count ?? 0);
    }

    renderStrip() {
      const hist = this.title?.meta?.hist ?? [];
      const max = Math.max(1, ...hist);
      if (this.el.hist.childElementCount !== hist.length) {
        this.el.hist.innerHTML = hist.map(() => '<i></i>').join('');
      }
      const bars = this.el.hist.children;
      for (let i = 0; i < hist.length; i++) {
        const h = hist[i] ? 6 + Math.round((hist[i] / max) * 36) : 2;
        bars[i].style.height = h + 'px';
        bars[i].classList.toggle('hot', hist[i] >= max * 0.8 && hist[i] > 2);
      }
      this.renderStripProgress();
    }
    renderStripProgress() {
      const hs = this.title?.meta?.histSeconds ?? 10;
      const idx = Math.floor(this.now / hs);
      const bars = this.el.hist.children;
      for (let i = 0; i < bars.length; i++) bars[i].classList.toggle('past', i <= idx);
    }

    renderList(force = false) {
      if (!this.title || !this.open) return;
      const now = this.now;
      const vis = this.visible();
      const top = vis.filter((c) => c.parentId == null);
      const replies = new Map();
      for (const c of vis) if (c.parentId != null) { if (!replies.has(c.parentId)) replies.set(c.parentId, []); replies.get(c.parentId).push(c); }

      let items;
      if (this.tab === 'top') items = top.sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0) || (b.replyCount ?? 0) - (a.replyCount ?? 0) || a.t - b.t);
      else if (this.tab === 'new') items = top.sort((a, b) => b.createdAt - a.createdAt);
      else items = top.sort((a, b) => a.t - b.t || a.createdAt - b.createdAt);

      const nowIds = new Set(this.tab === 'live' ? items.filter((c) => now - c.t >= 0 && now - c.t < NOW_WINDOW).map((c) => c.id) : []);
      const hidden = this.hiddenCount();
      const sig = this.tab + '|' + items.map((c) => `${c.id}:${c.likeCount}:${c.liked ? 1 : 0}:${c.replyCount}:${c.pending ? 1 : 0}:${c.failed ? 1 : 0}:${this.expanded.has(c.id) ? 1 : 0}`).join(',') + '|' + [...nowIds].join(',') + '|' + hidden + '|' + [...replies.values()].flat().map((r) => r.id + ':' + r.likeCount).join(',');
      if (!force && sig === this.lastSig) return;
      this.lastSig = sig;

      let html = '';
      if (!items.length) {
        const m = this.title.meta;
        html = `<div class="empty">${!m ? 'Loading comments…' : hidden ? `<b>${hidden}</b> comment${hidden === 1 ? '' : 's'} ahead of you.<br>Keep watching, or turn off the spoiler guard.` : this.title.offline ? 'Server unreachable and nothing cached yet.' : '<b>Nothing here yet.</b><br>Be the first — pause on a moment and say something.'}</div>`;
      } else {
        let lastNow = null;
        for (const c of items) {
          const isNow = nowIds.has(c.id);
          if (this.tab === 'live' && isNow !== lastNow) {
            if (isNow) html += '<div class="divider">happening now</div>';
            else if (lastNow === true) html += '<div class="divider">earlier</div>';
            lastNow = isNow;
          }
          html += this.renderComment(c, isNow);
          if (this.expanded.has(c.id)) for (const r of (replies.get(c.id) ?? []).sort((a, b) => a.createdAt - b.createdAt)) html += this.renderComment(r, false, true);
        }
      }
      if (hidden && items.length) html += `<div class="hidden-row"><span>${hidden} comment${hidden === 1 ? '' : 's'} ahead of you hidden</span><button data-act="showahead">Show anyway</button></div>`;
      this.el.list.innerHTML = html;
      if (this.tab === 'live' && Date.now() - this.userScrolledAt > 6000 && nowIds.size) {
        const last = [...nowIds].pop();
        const el = this.el.list.querySelector(`.cm[data-id="${last}"]`);
        if (el) this.el.list.scrollTop = Math.max(0, el.offsetTop + el.offsetHeight - this.el.list.clientHeight * 0.66);
      }
    }

    renderComment(c, isNow, isReply = false) {
      const cls = ['cm', isNow && 'now', c.pending && 'pending', c.failed && 'failed', isReply && 'reply'].filter(Boolean).join(' ');
      const status = c.pending ? ' · sending…' : c.failed ? ` · failed: ${esc(c.failed)}` : '';
      const canAct = !String(c.id).startsWith('local-');
      return `
<div class="${cls}" data-id="${esc(c.id)}">
  <div class="av" style="background:${avatarColor(c.authorId)}">${esc(initial(c.authorName))}</div>
  <div class="bd">
    <div class="meta"><span class="who">${esc(c.authorName)}</span>${c.mine ? '<span class="you">you</span>' : ''}${isReply ? '' : `<button class="tpill" data-act="seek" data-t="${c.t}" title="Jump to ${fmtTime(c.t)}">${fmtTime(c.t)}</button>`}<span class="age">· ${timeAgo(c.createdAt)}${status}</span></div>
    <div class="txt">${esc(c.body)}</div>
    <div class="acts">
      <button class="like ${c.liked ? 'on' : ''}" data-act="like" ${canAct ? '' : 'disabled'}>${ICON.heart}<span>${compact(c.likeCount ?? 0)}</span></button>
      ${isReply ? '' : `<button data-act="reply" ${canAct ? '' : 'disabled'}>Reply</button>`}
      ${!isReply && c.replyCount ? `<button data-act="toggle">${this.expanded.has(c.id) ? 'Hide replies' : `View ${c.replyCount} repl${c.replyCount === 1 ? 'y' : 'ies'}`}</button>` : ''}
      ${c.mine ? '<button data-act="delete">Delete</button>' : ''}
    </div>
  </div>
</div>`;
    }

    onListClick(e) {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const act = b.dataset.act;
      if (act === 'showahead') { this.showAhead = true; this.renderSpoilerBtn(); this.renderList(true); return; }
      const row = b.closest('.cm'); const id = row?.dataset.id;
      const c = this.title.all().find((x) => String(x.id) === id);
      if (act === 'seek') this.seek(Number(b.dataset.t));
      else if (act === 'like' && c) this.title.toggleLike(c.id);
      else if (act === 'reply' && c) { this.setReply(c); this.el.ta.focus(); }
      else if (act === 'toggle' && c) {
        if (this.expanded.has(c.id)) this.expanded.delete(c.id); else { this.expanded.add(c.id); this.title.ensureBucket(NFC.bucketOf(c.t), true); }
        this.renderList(true);
      }
      else if (act === 'delete' && c) {
        if (b.dataset.confirm) this.title.remove(c.id);
        else { b.dataset.confirm = '1'; b.textContent = 'Really delete?'; setTimeout(() => { if (b.isConnected) { delete b.dataset.confirm; b.textContent = 'Delete'; } }, 3000); }
      }
    }

    scrollTo(id) {
      this.el.list.querySelector(`.cm[data-id="${id}"]`)?.scrollIntoView({ block: 'center' });
    }

    // ---------- composer ----------
    beginCompose() {
      if (this.composeT == null) { this.composeT = this.replyTo ? this.replyTo.t : this.now; this.el.at.textContent = fmtTime(this.composeT); }
      if (store.settings.pauseOnCompose && this.video && !this.video.paused) {
        try { this.video.pause(); this.pausedByUs = true; } catch { /* ignore */ }
      }
    }
    endCompose() {
      this.composeT = null; this.el.at.textContent = fmtTime(this.now);
      this.el.ta.value = ''; this.el.ta.style.height = 'auto'; this.el.send.disabled = true;
      this.setReply(null);
      if (this.pausedByUs && this.video) { try { this.video.play(); } catch { /* ignore */ } }
      this.pausedByUs = false;
    }
    cancelCompose() { this.endCompose(); this.el.ta.blur(); }
    setReply(c) {
      this.replyTo = c;
      this.el.replyto.innerHTML = c ? `replying to <b>${esc(c.authorName)}</b> <button title="cancel reply">✕</button>` : '';
      if (c) { this.composeT = c.t; this.el.at.textContent = fmtTime(c.t); this.el.ta.placeholder = `Reply to ${c.authorName}…`; }
      else this.el.ta.placeholder = 'Say something about this moment…';
    }
    submit() {
      const body = this.el.ta.value.trim();
      if (!body || !this.title) return;
      const t = this.composeT ?? this.now;
      const parentId = this.replyTo?.id ?? null;
      if (parentId != null) this.expanded.add(parentId);
      this.title.post(t, body, parentId);
      this.endCompose();
      this.tab = 'live';
      for (const tb of this.el.tabs.querySelectorAll('.tab')) tb.classList.toggle('on', tb.dataset.tab === 'live');
      this.userScrolledAt = 0;
      this.renderList(true);
      this.el.ta.blur();
    }

    // ---------- toasts ----------
    maybeToast() {
      if (!store.settings.showToasts || !this.title) return;
      if (this.open && this.tab === 'live') return; // the live tab already highlights them
      const now = this.now;
      const due = this.visible().filter((c) => c.parentId == null && !this.toasted.has(c.id) && now - c.t >= 0 && now - c.t < 1.5);
      for (const c of due.sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0)).slice(0, 2)) {
        this.toasted.add(c.id);
        this.toast(c);
      }
      // allow re-toasting after a seek backwards
      for (const id of this.toasted) { const c = this.title.all().find((x) => x.id === id); if (c && c.t > now + 2) this.toasted.delete(id); }
    }
    toast(c) {
      const el = document.createElement('div');
      el.className = 'toast'; el.dataset.id = c.id;
      el.innerHTML = `<div class="av" style="background:${avatarColor(c.authorId)}">${esc(initial(c.authorName))}</div><div><div class="who"><b>${esc(c.authorName)}</b> · ${fmtTime(c.t)}${c.likeCount ? ` · ♥ ${compact(c.likeCount)}` : ''}</div><div class="txt">${esc(c.body)}</div></div>`;
      this.el.toasts.appendChild(el);
      while (this.el.toasts.childElementCount > MAX_TOASTS) this.el.toasts.firstElementChild.remove();
      this.expireToast(el, TOAST_MS);
    }
    // A toast only counts down while the video plays, so pausing to read keeps it on screen.
    expireToast(el, ms) {
      setTimeout(() => {
        if (!el.isConnected) return;
        if (this.video?.paused) return this.expireToast(el, 500);
        el.classList.add('out'); setTimeout(() => el.remove(), 400);
      }, ms);
    }
  }

  function isTyping(e) {
    const t = e.composedPath()[0];
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  NFC.UI = UI;
})();

// Entry point: watches the SPA URL + <video>, wires the player clock to the UI, loads nearby buckets.
(async () => {
  const NFC = window.NFC;
  const store = NFC.store;
  await store.init();

  const ui = new NFC.UI();
  let videoId = null, video = null, title = null, lastBucket = -1;

  const site = NFC.site;
  if (!site) return;
  const detectName = () => site.title();
  const parseVideoId = () => site.videoId(location);

  async function sync() {
    const id = parseVideoId();
    const v = site.video();
    if (id !== videoId) {
      videoId = id; lastBucket = -1;
      if (!id) { title = null; ui.host.remove(); return; }
      title = await store.loadTitle(id);
      ui.mount();
      ui.setTitle(title, v);
    }
    if (!id) return;
    ui.mount(); // SPA players build their container after we load; keep the overlay inside it
    if (v !== video) {
      if (video) { video.removeEventListener('timeupdate', onTime); video.removeEventListener('seeked', onTime); }
      video = v; ui.setVideo(v);
      if (v) { v.addEventListener('timeupdate', onTime); v.addEventListener('seeked', onTime); onTime(); }
    }
    if (title && !title.reported) {
      const name = detectName();
      const dur = v ? site.clock(v).duration : null;
      if (name && dur) title.reportTitle(name, dur);
      else if (name && !title.name) { title.name = name; ui.renderHeader(); }
    }
  }

  function onTime() {
    if (!video || !title) return;
    const { now, duration } = site.clock(video);
    ui.tick(now, duration);
    const b = NFC.bucketOf(now);
    if (b !== lastBucket) { lastBucket = b; [b - 1, b, b + 1].forEach((x) => title.ensureBucket(x)); }
    title.fetchMeta(); // no-op if fresh
  }

  // Netflix is a single-page app; poll for URL / video changes instead of relying on navigation events.
  setInterval(sync, 700);
  setInterval(() => { if (title) { title.fetchMeta(); [lastBucket - 1, lastBucket, lastBucket + 1].forEach((x) => x >= 0 && title.ensureBucket(x)); } }, 30_000);
  sync();
})();
