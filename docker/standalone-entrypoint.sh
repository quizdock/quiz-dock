#!/bin/sh
# QuizDock all-in-one (:standalone) — PostgreSQL + Redis + app in one container.
# Run as the non-root `quizdock` user (owns /data). Idempotent across restarts:
# initdb only on first boot, DB created if missing, migrations are idempotent.
set -e

PGDATA="${PGDATA:-/data/postgres}"
MEDIA_DIR="${MEDIA_DIR:-/data/media}"
# Debian puts server tools (initdb/pg_ctl) under /usr/lib/postgresql/<ver>/bin.
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
export PATH="$PGBIN:$PATH"

mkdir -p "$PGDATA" "$MEDIA_DIR"

# --- PostgreSQL: init once, then start ---
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "[standalone] initializing PostgreSQL cluster…"
  initdb -D "$PGDATA" -U quizdock --auth-local=trust --auth-host=trust --encoding=UTF8 >/dev/null
  echo "listen_addresses='localhost'" >>"$PGDATA/postgresql.conf"
fi

echo "[standalone] starting PostgreSQL…"
# Socket dir in /tmp (the default /var/run/postgresql isn't writable by a non-root
# user). We connect over TCP 127.0.0.1, so the socket location is irrelevant to clients.
pg_ctl -D "$PGDATA" -w -t 60 \
  -o "-c listen_addresses=localhost -c port=5432 -c unix_socket_directories=/tmp" start

if ! psql -h 127.0.0.1 -U quizdock -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='quizdock'" | grep -q 1; then
  echo "[standalone] creating database 'quizdock'…"
  createdb -h 127.0.0.1 -U quizdock quizdock
fi

# --- Redis (ephemeral: live-game state only) ---
echo "[standalone] starting Redis…"
redis-server --bind 127.0.0.1 --port 6379 --save '' --appendonly no >/tmp/redis.log 2>&1 &
REDIS_PID=$!

# --- migrations (idempotent) ---
echo "[standalone] applying migrations…"
(cd /app && node node_modules/prisma/build/index.js migrate deploy)

# --- graceful shutdown (fast PG stop so `docker stop` returns quickly) ---
shutdown() {
  echo "[standalone] shutting down…"
  kill "$APP_PID" 2>/dev/null || true
  kill "$REDIS_PID" 2>/dev/null || true
  pg_ctl -D "$PGDATA" -m fast -w stop 2>/dev/null || true
  exit 0
}
trap shutdown TERM INT

# --- app ---
echo "[standalone] starting QuizDock on :${PORT:-3000} …"
cd /app
node dist/main.js &
APP_PID=$!
wait "$APP_PID"
