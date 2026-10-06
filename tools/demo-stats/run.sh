#!/bin/sh
# The public demo's audience counter (Cloudflare Worker + D1), handled with wrangler
# in a container: the host needs Docker only. The Cloudflare token is read from
# CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID); nothing is kept in the image.
#   tools/demo-stats/run.sh test                      the Worker against SQLite
#   (the D1 database quizdock-demo-stats exists; its id is in wrangler.toml)
#   tools/demo-stats/run.sh d1 migrations apply quizdock-demo-stats --remote
#   tools/demo-stats/run.sh secret put STATS_TOKEN    the same as DEMO_STATS_TOKEN
#   tools/demo-stats/run.sh deploy
#   tools/demo-stats/run.sh d1 execute quizdock-demo-stats --remote \
#     --command "SELECT * FROM stats_daily ORDER BY day DESC LIMIT 30"
# Anyone reads the aggregates: GET <Worker URL>/stats (?days=1..400, 30 by default).
# The demo then needs DEMO_STATS_URL (the Worker's URL) and DEMO_STATS_TOKEN.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
if [ "${1:-}" = test ]; then
  exec docker run --rm -v "$here:/w:ro" -w /w node:24 node --test src/index.test.mjs
fi
# The token from the environment, else from .cloudflare-token beside this script
# (never committed): copy it in Cloudflare, then `pbpaste > tools/demo-stats/.cloudflare-token`.
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -f "$here/.cloudflare-token" ]; then
  CLOUDFLARE_API_TOKEN=$(tr -d '[:space:]' < "$here/.cloudflare-token")
  export CLOUDFLARE_API_TOKEN
fi
# A terminal when there is one; a pipe otherwise (`… | run.sh secret put STATS_TOKEN`).
tty=-i
[ -t 0 ] && tty=-it
exec docker run --rm $tty -v "$here:/w" -w /w -v quizdock-wrangler:/root/.npm \
  -e CLOUDFLARE_API_TOKEN -e CLOUDFLARE_ACCOUNT_ID \
  node:24 npx --yes wrangler@4 "$@"
