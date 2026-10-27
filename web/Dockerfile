FROM node:26.12.1-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@12.15.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG BASE_PATH=/family-tree
RUN BASE_PATH="$BASE_PATH" pnpm build

FROM node:26.12.1-bookworm-slim
ENV NODE_ENV=production PORT=8000 DATA_DIR=/data BACKUP_DIR=/backup
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts/server.mjs /app/scripts/maintain.mjs /app/scripts/config.mjs /app/scripts/proxy.mjs /app/scripts/cloudflare-storage.mjs ./scripts/
COPY --from=build /app/schema.sql ./schema.sql
RUN mkdir /data /backup && chown node:node /data /backup
USER node
EXPOSE 8000
CMD ["node", "scripts/server.mjs"]
