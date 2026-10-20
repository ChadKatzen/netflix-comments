// Builds dev/inject.js: the content scripts concatenated behind a shim that fakes chrome.storage/runtime so the
// overlay can be pasted into a real player page (DevTools console or a CDP javascript tool) for a visual check
// without installing the extension. Network goes straight to API_BASE with fetch (the page's CSP may block it).
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.API_BASE || 'http://localhost:3131';
const shim = `
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
  const OFFLINE = ${JSON.stringify(process.env.OFFLINE === '1')};
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
  mem.sync.settings = { readBase: ${JSON.stringify(API)}, writeBase: ${JSON.stringify(API)}, displayName: 'chad', spoilerGuard: true, showToasts: true, panelOpen: true };
})();
`;
const files = ['util.js', 'sites.js', 'styles.js', 'store.js', 'ui.js', 'main.js'].map((f) => readFileSync(join(root, 'extension', 'content', f), 'utf8'));
writeFileSync(join(root, 'dev', 'inject.js'), shim + '\n' + files.join('\n'));
console.log('wrote dev/inject.js', (shim.length + files.join('\n').length), 'bytes');
