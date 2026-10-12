// Pure functions that turn a title's full comment list into the static JSON the extension reads.
import { BUCKET_SECONDS, HIST_SECONDS, TOP_N, NEWEST_N } from './constants.js';

export const bucketOf = (t) => Math.floor(t / BUCKET_SECONDS);

/** @param comments all comments for a title (top-level + replies), each with likeCount/replyCount */
export function buildSnapshot(title, comments) {
  const generatedAt = Date.now();
  const topLevel = comments.filter((c) => c.parentId == null);
  const maxT = comments.reduce((m, c) => Math.max(m, c.t), 0);
  const duration = title?.duration && title.duration > 0 ? title.duration : maxT;

  const hist = new Array(Math.floor(duration / HIST_SECONDS) + 1).fill(0);
  for (const c of topLevel) hist[Math.min(hist.length - 1, Math.floor(c.t / HIST_SECONDS))]++;

  const bucketCounts = {};
  const buckets = new Map();
  for (const c of comments) {
    const b = bucketOf(c.t);
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b).push(c);
    if (c.parentId == null) bucketCounts[b] = (bucketCounts[b] ?? 0) + 1;
  }

  const top = [...topLevel]
    .sort((a, b) => b.likeCount - a.likeCount || b.replyCount - a.replyCount || a.createdAt - b.createdAt)
    .slice(0, TOP_N);
  const newest = [...topLevel].sort((a, b) => b.createdAt - a.createdAt).slice(0, NEWEST_N);

  const meta = {
    videoId: title.videoId,
    name: title.name ?? '',
    duration: title.duration ?? null,
    count: topLevel.length,
    totalWithReplies: comments.length,
    bucketSeconds: BUCKET_SECONDS,
    bucketCounts,
    histSeconds: HIST_SECONDS,
    hist,
    top,
    newest,
    generatedAt,
  };

  const bucketFiles = {};
  for (const [b, list] of buckets) {
    list.sort((a, c) => a.t - c.t || a.createdAt - c.createdAt);
    bucketFiles[b] = { videoId: title.videoId, bucket: b, comments: list, generatedAt };
  }
  return { meta, buckets: bucketFiles };
}

export const metaPath = (videoId) => `t/${videoId}/meta.json`;
export const bucketPath = (videoId, b) => `t/${videoId}/b/${b}.json`;
