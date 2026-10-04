#!/bin/sh
# `pnpm generate:api` in a container, for a host whose node_modules cannot run it
# (macOS binaries) and must not be rewritten by a Linux install. The sources are copied
# into the container, installed there from the lockfile, the backend is built, its
# OpenAPI written and the client generated; only these two outputs come back:
#   apps/backend/openapi/openapi.json
#   apps/frontend/src/api/generated/
# The pnpm store lives in the volume quizdock-generate-api, so later runs install fast.
#   tools/generate-api/run.sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
node=$(cat "$root/.nvmrc")
# The files written back are made the host user's (a Linux host would get root's).
docker run --rm -v "$root:/src" -v quizdock-generate-api:/store -e CI=true -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e OWNER="$(id -u):$(id -g)" \
  "node:$node" sh -euc '
    mkdir /work && cd /src
    tar -cf - --exclude=node_modules --exclude=dist \
      package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json \
      .prettierrc.json .prettierignore packages apps/backend apps/frontend \
      | tar -C /work -xf -
    cd /work
    corepack enable 2>/dev/null
    pnpm install --frozen-lockfile --store-dir /store --reporter=silent
    pnpm contracts:build >/dev/null
    pnpm --filter @quiz-dock/backend build >/dev/null
    pnpm generate:api
    cp apps/backend/openapi/openapi.json /src/apps/backend/openapi/
    rm -rf /src/apps/frontend/src/api/generated
    cp -R apps/frontend/src/api/generated /src/apps/frontend/src/api/
    chown -R "$OWNER" /src/apps/backend/openapi/openapi.json /src/apps/frontend/src/api/generated
  '
git -C "$root" status --short -- apps/backend/openapi apps/frontend/src/api/generated
