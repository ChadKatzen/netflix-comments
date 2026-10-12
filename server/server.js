// Netflix Comments — zero-dependency dev/self-host server. Node >= 22.5.
//
//   Reads : GET /t/:videoId/meta.json, GET /t/:videoId/b/:bucket.json   (static snapshots, CDN-cacheable)
//   Writes: /api/*  (see shared/routes.js)                               (re-renders that title's snapshot)
//   Dev   : GET /watch/:anything  -> mock Netflix player page
//
//   PORT=3131 DB_PATH=./data/comments.sqlite SNAP_DIR=./data/snapshots node server.js
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './db-node.js';
import { handleApi, HttpError, CORS } from './shared/routes.js';
import { buildSnapshot, metaPath, bucketPath } from './shared/snapshot.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3131);
const DB_PATH = process.env.DB_PATH || join(__dirname, 'data', 'comments.sqlite');
const SNAP_DIR = process.env.SNAP_DIR || join(__dirname, 'data', 'snapshots');
const SNAPSHOT_CACHE = process.env.SNAPSHOT_CACHE || 'public, max-age=20, stale-while-revalidate=300';
const RATE_WINDOW_MS = 60_000, RATE_MAX = Number(process.env.RATE_MAX || 120); // writes per client ip per minute

const store = openStore(DB_PATH);
const recent = new Map();

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

async function renderSnapshot(videoId) {
  const title = (await store.getTitle(videoId)) ?? { videoId, name: '', duration: null };
  const comments = await store.listAll(videoId);
  const snap = buildSnapshot(title, comments);
  writeJson(join(SNAP_DIR, metaPath(videoId)), snap.meta);
  for (const [b, file] of Object.entries(snap.buckets)) writeJson(join(SNAP_DIR, bucketPath(videoId, b)), file);
  // Buckets that emptied out (comments deleted) get an empty file so readers stop seeing stale comments.
  const bdir = join(SNAP_DIR, `t/${videoId}/b`);
  if (existsSync(bdir)) {
    for (const f of readdirSync(bdir)) {
      const b = f.match(/^(\d+)\.json$/)?.[1];
      if (b && !snap.buckets[b]) writeJson(join(bdir, f), { videoId, bucket: Number(b), comments: [], generatedAt: snap.meta.generatedAt });
    }
  }
}

function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(obj));
  renameSync(tmp, path); // atomic swap so readers never see a half-written file
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  try {
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET') rateLimit(req.socket.remoteAddress ?? 'unknown');
      const out = await handleApi({
        method: req.method, pathname: url.pathname, searchParams: url.searchParams, json: () => readJson(req),
      }, store);
      if (out.dirty) await renderSnapshot(out.dirty); // local dev: re-render synchronously
      return json(res, out.status, out.body);
    }
    if (url.pathname.startsWith('/t/')) return serveSnapshot(url, res);
    if (url.pathname === '/dev/silence.wav') return serveSilence(req, url, res);
    return serveStatic(url, res);
  } catch (e) {
    const status = e.status ?? 500;
    if (status === 500) console.error(e);
    return json(res, status, { error: e.message || 'server error' });
  }
});

function serveSnapshot(url, res) {
  const rel = url.pathname.slice(1).replace(/\.\./g, '');
  if (!/^t\/[\w.-]+\/(meta\.json|b\/\d+\.json)$/.test(rel)) return json(res, 404, { error: 'not found' });
  const file = join(SNAP_DIR, rel);
  if (!existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=10' });
    return res.end('{"error":"no snapshot"}');
  }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': SNAPSHOT_CACHE });
  res.end(readFileSync(file));
}

// A silent WAV of the requested length (default 600 s) so the mock player has instant, offline media.
function serveSilence(req, url, res) {
  const secs = Math.min(7200, Math.max(1, Number(url.searchParams.get('secs')) || 600));
  const rate = 8000, dataLen = secs * rate;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + dataLen, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate, 28); h.writeUInt16LE(1, 32); h.writeUInt16LE(8, 34);
  h.write('data', 36); h.writeUInt32LE(dataLen, 40);
  const total = 44 + dataLen;
  const hdr = { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400' };
  let start = 0, end = total - 1;
  const rh = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (rh) { if (rh[1]) start = Number(rh[1]); if (rh[2]) end = Number(rh[2]); if (!rh[1] && rh[2]) { start = total - Number(rh[2]); end = total - 1; } }
  if (start > end || end >= total) { res.writeHead(416, { 'Content-Range': `bytes */${total}` }); return res.end(); }
  res.writeHead(rh ? 206 : 200, { ...hdr, 'Content-Length': end - start + 1, ...(rh ? { 'Content-Range': `bytes ${start}-${end}/${total}` } : {}) });
  const chunk = Buffer.alloc(64 * 1024, 0x80); // 0x80 = silence for 8-bit PCM
  let pos = start;
  const pump = () => {
    while (pos <= end) {
      const buf = pos < 44 ? h.subarray(pos, Math.min(44, end + 1)) : chunk.subarray(0, Math.min(chunk.length, end - pos + 1));
      pos += buf.length;
      if (!res.write(buf)) return res.once('drain', pump);
    }
    res.end();
  };
  pump();
}

function serveStatic(url, res) {
  let file;
  if (url.pathname.startsWith('/watch/')) file = join(__dirname, 'public', 'watch.html');
  else if (url.pathname === '/') file = join(__dirname, 'public', 'index.html');
  else file = join(__dirname, 'public', url.pathname.replace(/\.\./g, ''));
  if (!existsSync(file)) return json(res, 404, { error: 'not found' });
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}

function rateLimit(key) {
  const now = Date.now();
  const arr = (recent.get(key) ?? []).filter((ts) => now - ts < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) throw new HttpError(429, 'slow down');
  arr.push(now);
  recent.set(key, arr);
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 64_000) reject(new HttpError(413, 'payload too large')); });
    req.on('end', () => { if (!data) return resolve({}); try { resolve(JSON.parse(data)); } catch { reject(new HttpError(400, 'invalid JSON')); } });
    req.on('error', reject);
  });
}

server.listen(PORT, () => {
  console.log(`netflix-comments server   http://localhost:${PORT}`);
  console.log(`db        ${DB_PATH}`);
  console.log(`snapshots ${SNAP_DIR}`);
  console.log(`mock      http://localhost:${PORT}/watch/demo`);
});
process.on('SIGINT', () => { store.close(); process.exit(0); });
