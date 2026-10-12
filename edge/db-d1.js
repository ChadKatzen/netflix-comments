// Cloudflare D1 adapter implementing the same async store interface as server/db-node.js.
// UNVERIFIED: written against the documented D1 client API (prepare().bind().first()/all()/run()),
// not yet deployed. See README "Deploying to Cloudflare".
import { HttpError, SQL, rowToComment, rowToTitle } from '../server/shared/routes.js';

export function d1Store(DB) {
  const first = (sql, ...args) => DB.prepare(sql).bind(...args).first();
  const all = async (sql, ...args) => (await DB.prepare(sql).bind(...args).all()).results;
  const run = (sql, ...args) => DB.prepare(sql).bind(...args).run();

  return {
    async getTitle(videoId) {
      return rowToTitle(await first(SQL.getTitle, videoId));
    },
    async upsertTitle(videoId, name, duration) {
      await run(SQL.upsertTitle, videoId, name ?? '', duration ?? null, Date.now());
      return rowToTitle(await first(SQL.getTitle, videoId));
    },
    async listAll(videoId) {
      return (await all(SQL.listAll, videoId)).map(rowToComment);
    },
    async addComment({ videoId, parentId, t, body, authorId, authorName }) {
      if (parentId != null) {
        const parent = await first(SQL.getComment, parentId);
        if (!parent || parent.video_id !== videoId) throw new HttpError(400, 'parent comment not found');
        if (parent.parent_id != null) throw new HttpError(400, 'replies can only be one level deep');
        t = parent.t;
      }
      const r = await run(SQL.insertComment, videoId, parentId ?? null, t, body, authorId, authorName, Date.now());
      return rowToComment(await first(SQL.getComment, r.meta.last_row_id));
    },
    async deleteComment(id, authorId) {
      const row = await first(SQL.getComment, id);
      if (!row) return null;
      const r = await run(SQL.deleteComment, id, authorId);
      return r.meta.changes > 0 ? row.video_id : null;
    },
    async toggleLike(commentId, userId) {
      const row = await first(SQL.getComment, commentId);
      if (!row) throw new HttpError(404, 'comment not found');
      const liked = !!(await first(SQL.hasLike, commentId, userId));
      if (liked) await run(SQL.removeLike, commentId, userId);
      else await run(SQL.addLike, commentId, userId, Date.now());
      const n = (await first(SQL.likeCount, commentId)).n;
      return { id: commentId, videoId: row.video_id, liked: !liked, likeCount: n };
    },
    async stats() {
      return first(SQL.stats);
    },
    async markDirty(videoId) {
      await run(SQL.markDirty, videoId, Date.now());
    },
    async takeDirty(limit = 50) {
      const now = Date.now();
      const ids = (await all(SQL.listDirty, limit)).map((r) => r.video_id);
      return { ids, ack: async () => { for (const id of ids) await run(SQL.clearDirty, id, now); } };
    },
  };
}
