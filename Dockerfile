# ---- 构建阶段 ----
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
COPY wrangler.toml.example ./
RUN npm run build:node && npm prune --omit=dev

# ---- 运行阶段 ----
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app

# 安装 openssl（entrypoint 需用于生成 ENCRYPTION_KEY/CRON_TOKEN）
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# 数据目录（挂载卷持久化；entrypoint 负责修复 bind mount 权限）
RUN mkdir -p /app/data

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY --from=build --chown=node:node /app/dist-node ./dist-node
COPY --from=build --chown=node:node /app/node_modules ./node_modules

EXPOSE 8791
VOLUME ["/app/data"]

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist-node/index.cjs"]