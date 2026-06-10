# syntax=docker/dockerfile:1

# ---- build ----
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app

# Manifests d'abord (cache des couches d'install)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/backend/package.json apps/backend/
# Le schéma Prisma doit être présent avant l'install : le postinstall du backend
# lance `prisma generate` (génère le client typé consommé par le code).
COPY apps/backend/prisma apps/backend/prisma
COPY apps/backend/prisma.config.ts apps/backend/
RUN pnpm install --filter @roux-quizz/backend... --no-frozen-lockfile

# Sources + build + déploiement prod auto-suffisant
COPY packages/contracts packages/contracts
COPY apps/backend apps/backend
RUN pnpm --filter @roux-quizz/contracts build \
 && pnpm --filter @roux-quizz/backend build \
 && pnpm --filter @roux-quizz/backend deploy --legacy --prod /out \
 # `pnpm deploy` reconstruit node_modules depuis le store et n'emporte PAS le
 # client Prisma généré (dossier `.prisma`). On le régénère DANS /out pour qu'il
 # atterrisse dans le node_modules embarqué (--schema → pas besoin du config TS).
 && cp -r apps/backend/prisma /out/prisma \
 && (cd /out && node_modules/.bin/prisma generate --schema prisma/schema.prisma)

# ---- runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main.js"]
