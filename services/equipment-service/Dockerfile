# Build context is the repo root (see docker-compose.yml): the lockfile and
# packages/shared live there, not in this folder.
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @spm-t5/equipment-service...
RUN pnpm --filter @spm-t5/equipment-service run build

FROM node:20-slim
RUN corepack enable
ENV NODE_ENV=production PORT=4000
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY services/equipment-service/package.json services/equipment-service/
RUN pnpm install --frozen-lockfile --prod --filter @spm-t5/equipment-service...
COPY --from=build /repo/services/equipment-service/dist services/equipment-service/dist
WORKDIR /repo/services/equipment-service
USER node
CMD ["node", "dist/index.js"]
