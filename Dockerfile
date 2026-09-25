# syntax=docker/dockerfile:1
#
# Image UNIQUE QuizDock : NestJS sert l'API REST + WebSocket + le SPA (front+back
# fusionnés). Postgres et Redis restent des services externes (état). Les
# migrations sont appliquées par le service one-shot `migrate` du
# docker-compose.prod.yml (même image, commande surchargée).

# ---- build (glibc, aligné avec le runtime distroless-debian) ----
FROM node:24-trixie-slim AS build
RUN corepack enable
WORKDIR /app
# Pin the schema-engine binary target. The slim image ships no libssl, so Prisma's
# platform detection falls back to "debian-openssl-1.1.x" and bakes that engine —
# while the distroless runtime (libssl3) detects "debian-openssl-3.0.x" and tries
# to download it at `migrate deploy` time (breaks air-gapped deploys, #31).
ENV PRISMA_CLI_BINARY_TARGETS=debian-openssl-3.0.x

# Manifests d'abord (cache des couches d'install).
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY apps/backend/prisma apps/backend/prisma
COPY apps/backend/prisma.config.ts apps/backend/
RUN pnpm install --filter @quiz-dock/backend... --filter @quiz-dock/frontend... --no-frozen-lockfile

# Sources + builds (front buildé en statique, back en dist, deploy prod auto-suffisant).
COPY packages/contracts packages/contracts
COPY apps/backend apps/backend
COPY apps/frontend apps/frontend
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
RUN pnpm --filter @quiz-dock/contracts build \
 && pnpm --filter @quiz-dock/frontend build \
 && pnpm --filter @quiz-dock/backend build \
 && pnpm --filter @quiz-dock/backend deploy --legacy --prod /out \
 # Schéma + config + migrations dans /out → consommés par le service `migrate`.
 && cp -r apps/backend/prisma /out/prisma \
 && cp apps/backend/prisma.config.ts /out/prisma.config.ts \
 && (cd /out && node_modules/.bin/prisma generate --schema prisma/schema.prisma) \
 # SPA buildé → servi par Nest (CLIENT_DIR).
 && cp -r apps/frontend/dist /out/client \
 # Media and template folders owned by the runtime's non-root uid: a fresh named
 # volume takes the ownership of the folder it is mounted on.
 && mkdir -p /data/media /data/store && chown -R 65532:65532 /data/media /data/store

# ---- runtime (distroless, non-root uid 65532) ----
# Debian 13: the Debian 12 image no longer follows Node releases nor OpenSSL fixes.
FROM gcr.io/distroless/nodejs24-debian13:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV CLIENT_DIR=/app/client
ENV MEDIA_DIR=/data/media \
    STORE_DIR=/data/store
COPY --from=build --chown=65532:65532 /out/node_modules ./node_modules
COPY --from=build --chown=65532:65532 /out/dist ./dist
COPY --from=build --chown=65532:65532 /out/client ./client
COPY --from=build --chown=65532:65532 /out/prisma ./prisma
COPY --from=build --chown=65532:65532 /out/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=65532:65532 /data/media /data/media
COPY --from=build --chown=65532:65532 /data/store /data/store
# Admin CLI as a plain command: `docker compose exec quizdock qd <cmd>`.
COPY --chmod=755 docker/qd /usr/local/bin/qd
# Déjà l'uid du tag :nonroot — rendu explicite (scanners, lecteurs).
USER 65532:65532
EXPOSE 3000
# Pas de shell dans l'image → sonde via node (fetch global). Le compose prod porte
# la même sonde avec son propre rythme ; `docker run` seul bénéficie de celle-ci.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# ENTRYPOINT de l'image distroless nodejs = `node` → CMD = arguments.
CMD ["dist/main.js"]
