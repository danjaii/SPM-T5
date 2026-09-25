# Build context is the repo root (see docker-compose.yml): the lockfile and
# packages/shared live there, not in this folder.
FROM node:20-slim AS build
WORKDIR /repo
COPY . .
RUN npm ci --workspace services/equipment-service --include-workspace-root=false
RUN npm run build --workspace services/equipment-service

FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY services/equipment-service/package.json services/equipment-service/
RUN npm ci --workspace services/equipment-service --omit=dev --include-workspace-root=false
COPY --from=build /repo/services/equipment-service/dist services/equipment-service/dist
WORKDIR /repo/services/equipment-service
USER node
CMD ["node", "dist/index.js"]
