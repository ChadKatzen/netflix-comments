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
