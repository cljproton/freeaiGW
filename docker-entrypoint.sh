#!/bin/sh
set -e

# 密钥持久化：ENCRYPTION_KEY / CRON_TOKEN 首次生成后写入数据卷 .secrets，
# 重建容器时复用同一把 Key——否则每次 `up -d` 都换 Key，已入库渠道密文将无法解密（见 附录 K / 陷阱）。
SECRETS_FILE="${SECRETS_FILE:-/app/data/.secrets}"

# 显式环境变量优先；文件只兜底"未设置的项"（. source 后恢复显式值）
if [ -f "$SECRETS_FILE" ]; then
  _ek="${ENCRYPTION_KEY:-}"
  _ct="${CRON_TOKEN:-}"
  . "$SECRETS_FILE"
  [ -n "$_ek" ] && ENCRYPTION_KEY="$_ek"
  [ -n "$_ct" ] && CRON_TOKEN="$_ct"
  unset _ek _ct
fi
if [ -z "${ENCRYPTION_KEY:-}" ]; then
  ENCRYPTION_KEY=$(openssl rand -hex 16)
  echo "Generated ENCRYPTION_KEY"
fi
if [ -z "${CRON_TOKEN:-}" ]; then
  CRON_TOKEN=$(openssl rand -hex 16)
  echo "Generated CRON_TOKEN"
fi

# 落盘（权限 600；显式 env 值同样写入，保证多次重建一致）
umask 077
mkdir -p "$(dirname "$SECRETS_FILE")"
printf 'ENCRYPTION_KEY=%s\nCRON_TOKEN=%s\n' "$ENCRYPTION_KEY" "$CRON_TOKEN" > "$SECRETS_FILE"
chmod 600 "$SECRETS_FILE" 2>/dev/null || true
export ENCRYPTION_KEY CRON_TOKEN

# bind mount 的 /app/data 通常由 Docker daemon 以 root 创建，
# 这里统一修复属主后降权到 node 用户运行，保证非 root 也能写数据库。
if [ -d /app/data ] && [ "$(id -u)" = "0" ]; then
  chown -R node:node /app/data
  exec setpriv --reuid=1000 --regid=1000 --clear-groups "$@"
fi

exec "$@"