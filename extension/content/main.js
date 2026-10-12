// Entry point: watches the SPA URL + <video>, wires the player clock to the UI, loads nearby buckets.
(async () => {
  const NFC = window.NFC;
  const store = NFC.store;
  await store.init();

  const ui = new NFC.UI();
  let videoId = null, video = null, title = null, lastBucket = -1;

  const TITLE_SELECTORS = [
    '[data-uia="video-title"]',          // Netflix player title block (shows while controls are visible)
    '.watch-video--title-text',
    '.video-title',
    '[data-uia="player-title"]',
  ];
  function detectName() {
    for (const sel of TITLE_SELECTORS) {
      const el = document.querySelector(sel);
      if (!el) continue;
      // Netflix renders show name + episode as adjacent inline elements with no whitespace between them.
      const parts = [...el.querySelectorAll('h4, span, div')].map((n) => n.children.length ? '' : n.textContent.trim()).filter(Boolean);
      const text = (parts.length ? parts.join(' ') : el.textContent).replace(/\s+/g, ' ').trim();
      if (text) return text.slice(0, 200);
    }
    return '';
  }

  function parseVideoId() {
    const m = location.pathname.match(/\/watch\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  async function sync() {
    const id = parseVideoId();
    const v = document.querySelector('video');
    if (id !== videoId) {
      videoId = id; lastBucket = -1;
      if (!id) { title = null; ui.host.remove(); return; }
      title = await store.loadTitle(id);
      ui.mount();
      ui.setTitle(title, v);
    }
    if (!id) return;
    if (v !== video) {
      if (video) { video.removeEventListener('timeupdate', onTime); video.removeEventListener('seeked', onTime); }
      video = v; ui.setVideo(v);
      if (v) { v.addEventListener('timeupdate', onTime); v.addEventListener('seeked', onTime); onTime(); }
    }
    if (title && !title.reported) {
      const name = detectName();
      const dur = v && Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null;
      if (name && dur) title.reportTitle(name, dur);
      else if (name && !title.name) { title.name = name; ui.renderHeader(); }
    }
  }

  function onTime() {
    if (!video || !title) return;
    const now = video.currentTime || 0;
    ui.tick(now, video.duration);
    const b = NFC.bucketOf(now);
    if (b !== lastBucket) { lastBucket = b; [b - 1, b, b + 1].forEach((x) => title.ensureBucket(x)); }
    title.fetchMeta(); // no-op if fresh
  }

  // Netflix is a single-page app; poll for URL / video changes instead of relying on navigation events.
  setInterval(sync, 700);
  setInterval(() => { if (title) { title.fetchMeta(); [lastBucket - 1, lastBucket, lastBucket + 1].forEach((x) => x >= 0 && title.ensureBucket(x)); } }, 30_000);
  sync();
})();
