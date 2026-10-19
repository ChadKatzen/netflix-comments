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
