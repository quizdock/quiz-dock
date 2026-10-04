#!/bin/sh
# A live room checked for real on the demo stack (tools/screenshots/compose.yml: the
# dev images and sources, a database of its own, http://localhost:${DEMO_PORT:-15183}).
# check.mjs drives the console, the projection and a phone in Playwright, prints each
# check and writes its pictures to LIVE_CHECK_OUT (a temporary folder by default).
#   tools/live-check/run.sh
#   LIVE_CHECK_PLAYERS=30 tools/live-check/run.sh   a crowded room
#   LIVE_CHECK_EXTREMES=1 tools/live-check/run.sh    the longest names and address
#   LIVE_CHECK_STACK=dev tools/live-check/run.sh     the dev stack as it runs, signed in
#     at its identity provider when it is in OIDC (the accounts of keycloak/
#     realm-export.json); its address is LIVE_CHECK_URL, else KEYCLOAK_DEV_URL of .env.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
out=${LIVE_CHECK_OUT:-$(mktemp -d)}
mkdir -p "$out" && out=$(cd "$out" && pwd) # absolute: docker takes a bare name for a volume
envval() { sed -n "s/^$1=//p" "$root/.env" 2>/dev/null | tail -1; }
if [ "${LIVE_CHECK_STACK:-demo}" = dev ]; then
  # The dev stack, reached at its own address; its mode is its .env's.
  network=bridge
  url=${LIVE_CHECK_URL:-$(envval KEYCLOAK_DEV_URL)}
  auth=$(envval AUTH_MODE)
  [ -n "$url" ] || { echo "LIVE_CHECK_URL or KEYCLOAK_DEV_URL is needed" >&2; exit 1; }
else
  "$root/tools/screenshots/run.sh" --up
  network=container:quizdock-demo-frontend-1
  url=http://localhost:5173
  auth=none
fi
docker run --rm --network "$network" --ipc host \
  -e URL="$url" -e AUTH="${auth:-none}" \
  -e PLAYERS="${LIVE_CHECK_PLAYERS:-4}" -e EXTREMES="${LIVE_CHECK_EXTREMES:-0}" \
  -v "$here:/check:ro" -v quizdock-demo-playwright:/work -v "$out:/out" \
  mcr.microsoft.com/playwright:v1.61.1-noble sh -c "cd /work \
    && { [ -d node_modules/playwright ] || npm install --no-audit --no-fund \
         playwright@1.61.1 socket.io-client@4 >/dev/null; } \
    && cp /check/check.mjs . && node check.mjs"
echo "pictures: $out"
