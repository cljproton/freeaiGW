#!/usr/bin/env bash
# 一键发布：typecheck → （可选 D1 迁移）→ 部署
# 用法：
#   bash scripts/publish.sh            # 常规发布（跳过远程 D1 迁移）
#   bash scripts/publish.sh --migrate  # 先执行远程 D1 迁移再发布
set -euo pipefail
cd "$(dirname "$0")/.."

MIGRATE=0
for arg in "$@"; do
  case "$arg" in
    --migrate) MIGRATE=1 ;;
    *) echo "未知参数: $arg（支持 --migrate）" >&2; exit 2 ;;
  esac
done

echo "==> [1/3] 类型检查"
npm run typecheck

if [[ "$MIGRATE" == "1" ]]; then
  echo "==> [2/3] 远程 D1 迁移"
  yes | npx wrangler d1 migrations apply DB --remote
else
  echo "==> [2/3] 跳过远程 D1 迁移（需要时使用 --migrate）"
fi

echo "==> [3/3] 部署"
npx wrangler deploy

echo "==> 发布完成"