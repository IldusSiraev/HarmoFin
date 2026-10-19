FROM node:24.20.0-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@11.24.0 --activate

WORKDIR /app

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json

RUN pnpm install --frozen-lockfile

FROM dependencies AS build

COPY . .

RUN pnpm db:generate && pnpm --filter @harmofin/web exec nuxt prepare && pnpm build
RUN pnpm --filter @harmofin/api --prod --legacy deploy /runtime/api
RUN cp -a node_modules/.pnpm/@prisma+client@*/node_modules/.prisma /runtime/api/node_modules/.pnpm/@prisma+client@*/node_modules/
RUN pnpm --filter @harmofin/worker --prod --legacy deploy /runtime/worker
RUN cp -a node_modules/.pnpm/@prisma+client@*/node_modules/.prisma /runtime/worker/node_modules/.pnpm/@prisma+client@*/node_modules/

FROM node:24.20.0-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS runtime-base

WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system app && adduser --system --ingroup app app

# Runtime stages start node directly; npm and npx are never invoked. Dropping them removes
# the npm-bundled copies of brace-expansion, undici and http-cache-semantics from the image.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

USER app

# Release version from the root package.json; the web reads it as
# runtimeConfig.public.appVersion, the API as config.appVersion.
ARG APP_VERSION=0.0.0-dev
ENV APP_VERSION=$APP_VERSION \
    NUXT_PUBLIC_APP_VERSION=$APP_VERSION

FROM runtime-base AS web

COPY --chown=app:app --from=build /app/apps/web/.output ./.output

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]

FROM runtime-base AS api

COPY --chown=app:app --from=build /runtime/api/node_modules ./node_modules
COPY --chown=app:app --from=build /app/apps/api/dist ./dist
COPY --chown=app:app --from=build /app/prisma ./prisma

EXPOSE 3001

CMD ["node", "dist/main.js"]

FROM runtime-base AS worker

COPY --chown=app:app --from=build /runtime/worker/node_modules ./node_modules
COPY --chown=app:app --from=build /app/apps/worker/dist ./dist

CMD ["node", "dist/main.js"]

FROM runtime-base AS migrate

COPY --chown=app:app --from=build /app/node_modules ./node_modules
COPY --chown=app:app --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --chown=app:app --from=build /app/prisma ./prisma

CMD ["node", "apps/api/node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "prisma/schema.prisma"]
