# syntax=docker/dockerfile:1

# ---- build ----
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/frontend/package.json apps/frontend/
RUN pnpm install --filter @quiz-dock/frontend... --no-frozen-lockfile

COPY packages/contracts packages/contracts
COPY apps/frontend apps/frontend
RUN pnpm --filter @quiz-dock/contracts build \
 && pnpm --filter @quiz-dock/frontend build

# ---- runtime (Nginx statique) ----
FROM nginx:alpine AS runtime
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html
# White-label : régénère /config.js depuis $APP_NAME au démarrage (avant nginx).
COPY apps/frontend/docker-entrypoint.sh /docker-entrypoint.d/40-generate-config.sh
RUN chmod +x /docker-entrypoint.d/40-generate-config.sh
EXPOSE 80
