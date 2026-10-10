-- One row per stream.leahcrhunter.com tab, for logs.leahcrhunter.com.
-- Times are unix seconds. A tab that closes says goodbye (ended_at); one that
-- can't (phone asleep, browser killed) just stops checking in, so last_seen is
-- the best guess at when it went.
CREATE TABLE stream_views (
  id         TEXT PRIMARY KEY,   -- per tab (sessionStorage)
  device     TEXT,               -- per browser (localStorage), groups a computer's tabs
  started_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  ended_at   INTEGER,
  ip         TEXT,
  country    TEXT,
  city       TEXT,
  user_agent TEXT
);
CREATE INDEX stream_views_by_start ON stream_views (started_at);
