#!/bin/sh
# The demo stack and the screenshots taken on it. The stack (project quizdock-demo)
# runs the dev images and sources on a database of its own, at
# http://localhost:${DEMO_PORT:-15183}, and stays up for demos. The screenshots
# use a host of their own (Mei): its bank is emptied and filled with the sample
# quizzes, it is made an administrator, Playwright photographs, assemble.mjs makes
# the composites and the GIF, and the host seat is let go.
#   tools/screenshots/run.sh           screenshots into docs/screenshots
#   tools/screenshots/run.sh --reset   from a fresh demo database first
#   tools/screenshots/run.sh --up      only start the demo stack
#   tools/screenshots/run.sh --film    only the demo GIF
#   SHOTS_OUT=/some/dir tools/screenshots/run.sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
out=${SHOTS_OUT:-$root/docs/screenshots}
cd "$root"
stack() {
  docker compose -p quizdock-demo -f docker-compose.yml -f docker-compose.override.yml \
    -f tools/screenshots/compose.yml "$@"
}
# In the frontend's network: the pages are at localhost:5173, as in dev.
net=container:quizdock-demo-frontend-1
browser() {
  docker run --rm --network "$net" --ipc host \
    -v "$here:/shots:ro" -v quizdock-demo-playwright:/work -v "$out:/out" \
    mcr.microsoft.com/playwright:v1.61.1-noble sh -c "cd /work \
      && { [ -d node_modules/playwright ] || npm install --no-audit --no-fund \
           playwright@1.61.1 socket.io-client@4 >/dev/null; } \
      && cp /shots/shoot.mjs . && node shoot.mjs $1"
}
[ "${1:-}" = "--reset" ] && stack down -v
stack up -d postgres redis backend frontend
until docker run --rm --network "$net" curlimages/curl -sf \
  http://localhost:5173/api/v1/auth/config >/dev/null 2>&1; do sleep 3; done
[ "${1:-}" = "--up" ] && exit 0
browser setup
stack exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -qc \
  "update \"user\" set assigned_roles = '"'"'{host,admin}'"'"' where oidc_subject = '"'"'local:mei'"'"'"'
browser "$([ "${1:-}" = "--film" ] && echo film || echo shoot)"
docker run --rm -v "$here:/shots:ro" -v "$out:/out" --entrypoint node \
  quizdock-sample-media /shots/assemble.mjs
