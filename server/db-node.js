// node:sqlite adapter implementing the async store interface used by shared/routes.js.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { HttpError, SCHEMA_SQL, SQL, rowToComment, rowToTitle } from './shared/routes.js';

export function openStore(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA_SQL);
  const q = Object.fromEntries(Object.entries(SQL).map(([k, sql]) => [k, db.prepare(sql)]));

  return {
    async getTitle(videoId) {
      return rowToTitle(q.getTitle.get(videoId));
    },
    async upsertTitle(videoId, name, duration) {
      q.upsertTitle.run(videoId, name ?? '', duration ?? null, Date.now());
      return rowToTitle(q.getTitle.get(videoId));
    },
    async listAll(videoId) {
      return q.listAll.all(videoId).map(rowToComment);
    },
    async addComment({ videoId, parentId, t, body, authorId, authorName }) {
      if (parentId != null) {
        const parent = q.getComment.get(parentId);
        if (!parent || parent.video_id !== videoId) throw new HttpError(400, 'parent comment not found');
        if (parent.parent_id != null) throw new HttpError(400, 'replies can only be one level deep');
        t = parent.t;
      }
      const r = q.insertComment.run(videoId, parentId ?? null, t, body, authorId, authorName, Date.now());
      return rowToComment(q.getComment.get(Number(r.lastInsertRowid)));
    },
    async deleteComment(id, authorId) {
      const row = q.getComment.get(id);
      if (!row) return null;
      return q.deleteComment.run(id, authorId).changes > 0 ? row.video_id : null;
    },
    async toggleLike(commentId, userId) {
      const row = q.getComment.get(commentId);
      if (!row) throw new HttpError(404, 'comment not found');
      const liked = !!q.hasLike.get(commentId, userId);
      if (liked) q.removeLike.run(commentId, userId);
      else q.addLike.run(commentId, userId, Date.now());
      return { id: commentId, videoId: row.video_id, liked: !liked, likeCount: q.likeCount.get(commentId).n };
    },
    async stats() {
      return q.stats.get();
    },
    async markDirty(videoId) {
      q.markDirty.run(videoId, Date.now());
    },
    async takeDirty(limit = 50) {
      const now = Date.now();
      const ids = q.listDirty.all(limit).map((r) => r.video_id);
      return { ids, ack: () => ids.forEach((id) => q.clearDirty.run(id, now)) };
    },
    close() { db.close(); },
  };
}
