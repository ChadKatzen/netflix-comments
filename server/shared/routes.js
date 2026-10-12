// Write-side API shared by the Node server and the Cloudflare Worker.
// `store` is an async adapter (see server/db-node.js and edge/db-d1.js).
import { MAX_BODY, MAX_NAME, MAX_TITLE, ID_RE, VIDEO_ID_RE } from './constants.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);
const str = (v) => (typeof v === 'string' ? v : '');
const clip = (s, n) => (s.length > n ? s.slice(0, n) : s);

/**
 * @param {{method:string, pathname:string, searchParams:URLSearchParams, json:()=>Promise<any>}} req
 * @param store async storage adapter
 * @returns {Promise<{status:number, body:any, dirty?:string}>}  dirty = videoId whose snapshot changed
 */
export async function handleApi(req, store) {
  const parts = req.pathname.split('/').filter(Boolean); // ['api', ...]
  const m = req.method;

  if (m === 'GET' && parts[1] === 'health' && parts.length === 2) {
    return { status: 200, body: { ok: true, ...(await store.stats()) } };
  }

  if (parts[1] === 'titles' && parts[2]) {
    const videoId = decodeURIComponent(parts[2]);
    if (!VIDEO_ID_RE.test(videoId)) throw bad('bad video id');

    // PUT /api/titles/:id {name, duration}
    if (m === 'PUT' && parts.length === 3) {
      const b = await req.json();
      const name = clip(str(b.name).trim(), MAX_TITLE);
      const duration = Number.isFinite(b.duration) && b.duration > 0 ? b.duration : null;
      const title = await store.upsertTitle(videoId, name, duration);
      return { status: 200, body: title, dirty: videoId };
    }

    // POST /api/titles/:id/comments {t, body, authorId, authorName, parentId?}
    if (m === 'POST' && parts[3] === 'comments' && parts.length === 4) {
      const b = await req.json();
      const body = str(b.body).trim();
      const authorId = str(b.authorId).trim();
      const authorName = clip(str(b.authorName).trim(), MAX_NAME) || 'viewer';
      const t = Number(b.t);
      const parentId = b.parentId == null ? null : Number(b.parentId);
      if (!body) throw bad('empty comment');
      if (body.length > MAX_BODY) throw bad(`comment too long (max ${MAX_BODY})`);
      if (!ID_RE.test(authorId)) throw bad('bad author id');
      if (!Number.isFinite(t) || t < 0) throw bad('bad timestamp');
      if (parentId != null && !Number.isInteger(parentId)) throw bad('bad parent id');
      await store.upsertTitle(videoId, '', null);
      const comment = await store.addComment({ videoId, parentId, t, body, authorId, authorName });
      return { status: 201, body: comment, dirty: videoId };
    }
  }

  if (parts[1] === 'comments' && parts[2]) {
    const id = Number(parts[2]);
    if (!Number.isInteger(id) || id <= 0) throw bad('bad comment id');

    // POST /api/comments/:id/like {userId}  (toggle)
    if (m === 'POST' && parts[3] === 'like' && parts.length === 4) {
      const b = await req.json();
      const userId = str(b.userId).trim();
      if (!ID_RE.test(userId)) throw bad('bad user id');
      const r = await store.toggleLike(id, userId);
      return { status: 200, body: r, dirty: r.videoId };
    }

    // DELETE /api/comments/:id?user=ID  (author only)
    if (m === 'DELETE' && parts.length === 3) {
      const userId = req.searchParams.get('user') ?? '';
      const videoId = await store.deleteComment(id, userId);
      if (!videoId) throw new HttpError(404, 'not found or not yours');
      return { status: 200, body: { ok: true }, dirty: videoId };
    }
  }

  throw new HttpError(404, 'no such route');
}

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Shared SQL (SQLite dialect; valid in node:sqlite and Cloudflare D1).
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS titles (
  video_id   TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  duration   REAL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id    TEXT NOT NULL,
  parent_id   INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  t           REAL NOT NULL,
  body        TEXT NOT NULL,
  author_id   TEXT NOT NULL,
  author_name TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_video_t ON comments(video_id, t);
CREATE TABLE IF NOT EXISTS likes (
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (comment_id, user_id)
);
CREATE TABLE IF NOT EXISTS dirty (
  video_id   TEXT PRIMARY KEY,
  marked_at  INTEGER NOT NULL
);
`;

export const SQL = {
  upsertTitle: `INSERT INTO titles (video_id, name, duration, updated_at) VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT(video_id) DO UPDATE SET
      name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE titles.name END,
      duration = COALESCE(excluded.duration, titles.duration),
      updated_at = excluded.updated_at`,
  getTitle: `SELECT * FROM titles WHERE video_id = ?1`,
  listAll: `SELECT c.*,
      (SELECT COUNT(*) FROM likes l WHERE l.comment_id = c.id) AS like_count,
      (SELECT COUNT(*) FROM comments r WHERE r.parent_id = c.id) AS reply_count
    FROM comments c WHERE c.video_id = ?1 ORDER BY c.t ASC, c.created_at ASC`,
  getComment: `SELECT * FROM comments WHERE id = ?1`,
  insertComment: `INSERT INTO comments (video_id, parent_id, t, body, author_id, author_name, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  deleteComment: `DELETE FROM comments WHERE id = ?1 AND author_id = ?2`,
  hasLike: `SELECT 1 AS x FROM likes WHERE comment_id = ?1 AND user_id = ?2`,
  addLike: `INSERT OR IGNORE INTO likes (comment_id, user_id, created_at) VALUES (?1, ?2, ?3)`,
  removeLike: `DELETE FROM likes WHERE comment_id = ?1 AND user_id = ?2`,
  likeCount: `SELECT COUNT(*) AS n FROM likes WHERE comment_id = ?1`,
  stats: `SELECT (SELECT COUNT(*) FROM titles) AS titles,
      (SELECT COUNT(*) FROM comments) AS comments,
      (SELECT COUNT(*) FROM likes) AS likes`,
  markDirty: `INSERT INTO dirty (video_id, marked_at) VALUES (?1, ?2)
    ON CONFLICT(video_id) DO UPDATE SET marked_at = excluded.marked_at`,
  listDirty: `SELECT video_id FROM dirty ORDER BY marked_at ASC LIMIT ?1`,
  clearDirty: `DELETE FROM dirty WHERE video_id = ?1 AND marked_at <= ?2`,
};

export function rowToComment(r) {
  return {
    id: r.id,
    parentId: r.parent_id ?? null,
    t: r.t,
    body: r.body,
    authorId: r.author_id,
    authorName: r.author_name,
    createdAt: r.created_at,
    likeCount: r.like_count ?? 0,
    replyCount: r.reply_count ?? 0,
  };
}

export function rowToTitle(r) {
  return r ? { videoId: r.video_id, name: r.name, duration: r.duration, updatedAt: r.updated_at } : null;
}
