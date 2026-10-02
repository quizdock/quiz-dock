# syntax=docker/dockerfile:1

# ---- build ----
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/frontend/package.json apps/frontend/
RUN pnpm install --filter @quiz-dock/frontend... --no-frozen-lockfile

COPY packages/contracts packages/contracts
COPY apps/frontend apps/frontend
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
RUN pnpm --filter @quiz-dock/contracts build \
 && pnpm --filter @quiz-dock/frontend build \
 && cp apps/frontend/dist/manifest.webmanifest apps/frontend/dist/manifest.base.webmanifest

# ---- runtime (Nginx statique, non-root : uid 101 `nginx`, écoute :8080) ----
FROM nginxinc/nginx-unprivileged:alpine AS runtime
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
# Web root owned by nginx's uid: the entrypoint writes the manifest there at start.
COPY --from=build --chown=nginx:nginx /app/apps/frontend/dist /usr/share/nginx/html
# Names the installed app after $APP_NAME at start (before nginx).
COPY --chmod=755 apps/frontend/docker-entrypoint.sh /docker-entrypoint.d/40-name-manifest.sh
# Déjà l'utilisateur de l'image unprivileged — rendu explicite (scanners, lecteurs).
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/"]
