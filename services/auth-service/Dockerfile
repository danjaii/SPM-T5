# Build context is the repo root (see docker-compose.yml): the lockfile and
# packages/shared live there, not in this folder.
FROM node:20-slim AS build
WORKDIR /repo
COPY . .
RUN npm ci --workspace services/auth-service --include-workspace-root=false
RUN npm run build --workspace services/auth-service

FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY services/auth-service/package.json services/auth-service/
RUN npm ci --workspace services/auth-service --omit=dev --include-workspace-root=false
COPY --from=build /repo/services/auth-service/dist services/auth-service/dist
WORKDIR /repo/services/auth-service
USER node
CMD ["node", "dist/index.js"]
