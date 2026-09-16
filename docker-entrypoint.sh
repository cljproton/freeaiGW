#!/bin/sh
set -e

# 首次启动自动生成 ENCRYPTION_KEY 与 CRON_TOKEN（无需手动配置）
if [ -z "${ENCRYPTION_KEY:-}" ]; then
  export ENCRYPTION_KEY=$(openssl rand -hex 16)
  echo "Generated ENCRYPTION_KEY"
fi
if [ -z "${CRON_TOKEN:-}" ]; then
  export CRON_TOKEN=$(openssl rand -hex 16)
  echo "Generated CRON_TOKEN"
fi

# bind mount 的 /app/data 通常由 Docker daemon 以 root 创建，
# 这里统一修复属主后降权到 node 用户运行，保证非 root 也能写数据库。
if [ -d /app/data ] && [ "$(id -u)" = "0" ]; then
  chown -R node:node /app/data
  exec setpriv --reuid=1000 --regid=1000 --clear-groups "$@"
fi

exec "$@"