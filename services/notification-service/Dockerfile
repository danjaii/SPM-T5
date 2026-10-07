# Build context is the repo root (see docker-compose.yml): the lockfile and
# packages/shared live there, not in this folder.
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @spm-t5/notification-service...
RUN pnpm --filter @spm-t5/notification-service run build

FROM node:22-slim
RUN corepack enable
ENV NODE_ENV=production PORT=4000
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY services/notification-service/package.json services/notification-service/
RUN pnpm install --frozen-lockfile --prod --filter @spm-t5/notification-service...
COPY --from=build /repo/services/notification-service/dist services/notification-service/dist
WORKDIR /repo/services/notification-service
USER node
CMD ["node", "dist/index.js"]
