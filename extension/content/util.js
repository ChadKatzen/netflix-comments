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
    if (d < 60) return 'now';
    if (d < 3600) return Math.floor(d / 60) + 'm';
    if (d < 86400) return Math.floor(d / 3600) + 'h';
    if (d < 86400 * 30) return Math.floor(d / 86400) + 'd';
    return Math.floor(d / (86400 * 30)) + 'mo';
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
