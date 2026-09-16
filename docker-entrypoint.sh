#!/bin/sh
set -e

# bind mount 的 /app/data 通常由 Docker daemon 以 root 创建，
# 这里统一修复属主后降权到 node 用户运行，保证非 root 也能写数据库。
if [ -d /app/data ] && [ "$(id -u)" = "0" ]; then
  chown -R node:node /app/data
  exec setpriv --reuid=1000 --regid=1000 --clear-groups "$@"
fi

exec "$@"