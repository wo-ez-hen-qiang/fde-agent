# fde-agent all-in-one image (web + embedded PGlite)
FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/model-gateway/package.json packages/model-gateway/
COPY packages/agent-runtime/package.json packages/agent-runtime/
COPY packages/data/package.json packages/data/
COPY packages/bot-core/package.json packages/bot-core/
RUN pnpm install --frozen-lockfile || pnpm install

FROM deps AS build
COPY . .
RUN pnpm --filter @fde/web run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3000
CMD ["pnpm", "--filter", "@fde/web", "run", "start"]
