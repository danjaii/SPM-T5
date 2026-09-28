FROM node:20-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @spm-t5/event-review-service...
RUN pnpm --filter @spm-t5/event-review-service run build

FROM node:20-slim
RUN corepack enable
ENV NODE_ENV=production PORT=4000
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY services/event-review-service/package.json services/event-review-service/
RUN pnpm install --frozen-lockfile --prod --filter @spm-t5/event-review-service...
COPY --from=build /repo/services/event-review-service/dist services/event-review-service/dist
WORKDIR /repo/services/event-review-service
USER node
CMD ["node", "dist/index.js"]
