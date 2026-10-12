// Cloudflare Worker: write API + cron snapshot renderer.
//
//  fetch():     /api/*  -> shared/routes.js against D1, then marks the title dirty
//  scheduled(): every minute, re-render dirty titles' snapshots into R2 (t/<id>/meta.json, t/<id>/b/<n>.json)
//
// Reads do NOT go through this Worker. Point the extension's "read base" at the R2 bucket's public
// custom domain (Cloudflare caches it at the edge; cached hits cost nothing and invoke no Worker).
//
// UNVERIFIED: not yet deployed. Bindings expected (wrangler.toml): DB (D1), SNAPSHOTS (R2).
import { handleApi, HttpError, CORS } from '../server/shared/routes.js';
import { buildSnapshot, metaPath, bucketPath } from '../server/shared/snapshot.js';
import { d1Store } from './db-d1.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS };
const SNAPSHOT_CACHE = 'public, max-age=30, stale-while-revalidate=600';

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'reads are served from the snapshot bucket' }), { status: 404, headers: JSON_HEADERS });
    }
    const store = d1Store(env.DB);
    try {
      const out = await handleApi({
        method: request.method,
        pathname: url.pathname,
        searchParams: url.searchParams,
        json: async () => { try { return await request.json(); } catch { throw new HttpError(400, 'invalid JSON'); } },
      }, store);
      if (out.dirty) ctx.waitUntil(store.markDirty(out.dirty));
      return new Response(JSON.stringify(out.body), { status: out.status, headers: JSON_HEADERS });
    } catch (e) {
      const status = e.status ?? 500;
      if (status === 500) console.error(e);
      return new Response(JSON.stringify({ error: e.message || 'server error' }), { status, headers: JSON_HEADERS });
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(renderDirty(env));
  },
};

async function renderDirty(env) {
  const store = d1Store(env.DB);
  const { ids, ack } = await store.takeDirty(100);
  for (const videoId of ids) {
    const title = (await store.getTitle(videoId)) ?? { videoId, name: '', duration: null };
    const comments = await store.listAll(videoId);
    const snap = buildSnapshot(title, comments);
    const put = (key, obj) => env.SNAPSHOTS.put(key, JSON.stringify(obj), {
      httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: SNAPSHOT_CACHE },
    });
    await put(metaPath(videoId), snap.meta);
    await Promise.all(Object.entries(snap.buckets).map(([b, file]) => put(bucketPath(videoId, b), file)));
    // Buckets that emptied out get an empty file so cached readers stop seeing deleted comments.
    const existing = await env.SNAPSHOTS.list({ prefix: `t/${videoId}/b/` });
    for (const obj of existing.objects) {
      const b = obj.key.match(/\/b\/(\d+)\.json$/)?.[1];
      if (b && !snap.buckets[b]) await put(obj.key, { videoId, bucket: Number(b), comments: [], generatedAt: snap.meta.generatedAt });
    }
  }
  await ack();
}
