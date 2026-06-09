# syntax=docker/dockerfile:1

# ---- build ----
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app

# Manifests d'abord (cache des couches d'install)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/backend/package.json apps/backend/
RUN pnpm install --filter @roux-quizz/backend... --no-frozen-lockfile

# Sources + build + déploiement prod auto-suffisant
COPY packages/contracts packages/contracts
COPY apps/backend apps/backend
RUN pnpm --filter @roux-quizz/contracts build \
 && pnpm --filter @roux-quizz/backend build \
 && pnpm --filter @roux-quizz/backend deploy --prod /out

# ---- runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main.js"]
