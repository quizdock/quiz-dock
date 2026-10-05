-- The public demo's audience, per UTC day. Only visitors_today relates to a visitor
-- (a hash of the day, unreadable without a salt that never left the demo's memory),
-- and it is emptied every night. The rest is aggregates, kept 13 months.

CREATE TABLE IF NOT EXISTS stats_daily (
  day     TEXT NOT NULL,
  country TEXT NOT NULL,
  hits    INTEGER NOT NULL DEFAULT 0,
  uniques INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, country)
);

CREATE TABLE IF NOT EXISTS durations_daily (
  day           TEXT PRIMARY KEY,
  total_seconds INTEGER NOT NULL DEFAULT 0,
  samples       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS render_starts (
  day   TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS visitors_today (
  day     TEXT NOT NULL,
  country TEXT NOT NULL,
  hash    TEXT NOT NULL,
  PRIMARY KEY (day, country, hash)
);
