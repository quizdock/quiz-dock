-- The Docker Hub repository's pull counter, read every night: a total, not a
-- visitor; the difference between two days is that day's pulls.

CREATE TABLE IF NOT EXISTS docker_pulls (
  day        TEXT PRIMARY KEY,
  pull_count INTEGER NOT NULL
);
