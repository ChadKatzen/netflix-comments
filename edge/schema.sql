-- D1 migration. Keep in sync with SCHEMA_SQL in server/shared/routes.js.
-- Apply: wrangler d1 execute netflix-comments --remote --file=schema.sql
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
