#!/bin/sh
# A live room checked for real on the demo stack (tools/screenshots/compose.yml: the
# dev images and sources, a database of its own, http://localhost:${DEMO_PORT:-15183}).
# check.mjs drives the console, the projection and a phone in Playwright, prints each
# check and writes its pictures to LIVE_CHECK_OUT (a temporary folder by default).
#   tools/live-check/run.sh
#   LIVE_CHECK_PLAYERS=30 tools/live-check/run.sh   a crowded room
#   LIVE_CHECK_EXTREMES=1 tools/live-check/run.sh    the longest names and address
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
out=${LIVE_CHECK_OUT:-$(mktemp -d)}
mkdir -p "$out" && out=$(cd "$out" && pwd) # absolute: docker takes a bare name for a volume
"$root/tools/screenshots/run.sh" --up
docker run --rm --network container:quizdock-demo-frontend-1 --ipc host \
  -e PLAYERS="${LIVE_CHECK_PLAYERS:-4}" -e EXTREMES="${LIVE_CHECK_EXTREMES:-0}" \
  -v "$here:/check:ro" -v quizdock-demo-playwright:/work -v "$out:/out" \
  mcr.microsoft.com/playwright:v1.61.1-noble sh -c "cd /work \
    && { [ -d node_modules/playwright ] || npm install --no-audit --no-fund \
         playwright@1.61.1 socket.io-client@4 >/dev/null; } \
    && cp /check/check.mjs . && node check.mjs"
echo "pictures: $out"
