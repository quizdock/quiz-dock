# syntax=docker/dockerfile:1
#
# Image UNIQUE QuizDock : NestJS sert l'API REST + WebSocket + le SPA (front+back
# fusionnés). Postgres et Redis restent des services externes (état). Les
# migrations sont appliquées par le service one-shot `migrate` du
# docker-compose.prod.yml (même image, commande surchargée).

# ---- build (glibc, aligné avec le runtime distroless-debian) ----
FROM node:24-bookworm-slim AS build
RUN corepack enable
WORKDIR /app

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
 # Dossier média possédé par l'uid non-root du runtime (volume hérite à la 1re init).
 && mkdir -p /data/media && chown -R 65532:65532 /data/media

# ---- runtime (distroless, non-root uid 65532) ----
FROM gcr.io/distroless/nodejs24-debian12:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV CLIENT_DIR=/app/client
ENV MEDIA_DIR=/data/media
COPY --from=build --chown=65532:65532 /out/node_modules ./node_modules
COPY --from=build --chown=65532:65532 /out/dist ./dist
COPY --from=build --chown=65532:65532 /out/client ./client
COPY --from=build --chown=65532:65532 /out/prisma ./prisma
COPY --from=build --chown=65532:65532 /out/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=65532:65532 /data/media /data/media
EXPOSE 3000
# ENTRYPOINT de l'image distroless nodejs = `node` → CMD = arguments.
CMD ["dist/main.js"]
