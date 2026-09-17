#!/usr/bin/env bash
# 本地 Node 服务一键启停脚本(生产构建模式)
# 与 Docker 运行同一套产物(node dist-node/index.cjs),单进程便于精确管理。
# 用法:
#   bash scripts/service.sh start|stop|restart|status|logs
#   bash scripts/service.sh --help
set -euo pipefail
cd "$(dirname "$0")/.."

ROOT="$(pwd)"
PID_FILE="$ROOT/data/service.pid"
LOG_FILE="$ROOT/data/service.log"
PORT="${PORT:-8791}"

# 从 .env 读取 PORT(缺失时用默认 8791)
if [ -f "$ROOT/.env" ]; then
  _p="$(sed -n 's/^PORT=//p' "$ROOT/.env" | tail -n1 | tr -d '"' | tr -d "'" | tr -d ' ')"
  [ -n "$_p" ] && PORT="$_p"
fi

# 读取 PID 文件中的 PID(无则输出空)
pid_from_file() {
  [ -f "$PID_FILE" ] && cat "$PID_FILE" || true
}

# 进程是否存活且确为本项目产物(校验 cmdline 防 PID 复用误判)
proc_alive() {
  local pid="$1"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  grep -aq "dist-node" "/proc/$pid/cmdline" 2>/dev/null || return 1
  return 0
}

# 端口是否已被监听(任意 TCP 占用即视为占用,不关心协议)
tcp_open() {
  (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null
}

# 等待端口释放(进程已退出但内核可能还没关 socket)
wait_port_closed() {
  local i
  for i in $(seq 1 20); do
    tcp_open || return 0
    sleep 0.5
  done
  return 1
}

cmd_start() {
  local pid
  pid="$(pid_from_file)"
  if proc_alive "$pid"; then
    echo "==> 服务已在运行(PID $pid),无需重复启动"
    return 0
  fi
  if [ -n "$pid" ]; then
    echo "==> 清理失效 PID 文件($pid 已不存在)"
    rm -f "$PID_FILE"
  fi
  if tcp_open; then
    echo "!!> 端口 $PORT 已被其他进程占用,请先释放或改 PORT 后重试" >&2
    return 1
  fi

  echo "==> [1/3] 构建 dist-node"
  npm run build:node

  echo "==> [2/3] 后台启动服务"
  mkdir -p "$ROOT/data"
  # setsid 使守护进程脱离当前会话/进程组,避免与启动命令同生共死
  if command -v setsid >/dev/null 2>&1; then
    setsid node dist-node/index.cjs >>"$LOG_FILE" 2>&1 < /dev/null &
  else
    nohup node dist-node/index.cjs >>"$LOG_FILE" 2>&1 < /dev/null &
  fi
  pid=$!
  echo "$pid" > "$PID_FILE"

  echo "==> [3/3] 等待端口就绪"
  local i
  for i in $(seq 1 40); do
    if tcp_open; then
      echo "==> 服务已启动: http://127.0.0.1:$PORT (PID $pid,日志 $LOG_FILE)"
      return 0
    fi
    if ! proc_alive "$pid"; then
      echo "!!> 启动失败,进程提前退出,最近日志:" >&2
      tail -n 20 "$LOG_FILE" 2>/dev/null >&2 || true
      rm -f "$PID_FILE"
      return 1
    fi
    sleep 0.5
  done
  echo "!!> 端口 $PORT 20 秒内未就绪,服务可能异常,日志见 $LOG_FILE" >&2
  kill "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  return 1
}

cmd_stop() {
  local pid
  pid="$(pid_from_file)"
  if [ -z "$pid" ]; then
    echo "==> 未找到 PID 文件,服务未在运行"
    return 0
  fi
  if ! proc_alive "$pid"; then
    echo "==> 进程 $pid 已不存活,清理 PID 文件"
    rm -f "$PID_FILE"
    return 0
  fi

  echo "==> 正在停止服务(PID $pid)"
  kill "$pid" 2>/dev/null || true

  local i
  for i in $(seq 1 20); do
    if ! proc_alive "$pid"; then
      if wait_port_closed; then
        rm -f "$PID_FILE"
        echo "==> 服务已停止"
        return 0
      fi
      echo "!!> 进程已退出但端口 $PORT 未释放,请稍后检查" >&2
      rm -f "$PID_FILE"
      return 1
    fi
    sleep 0.5
  done

  echo "==> 进程未响应(10 秒),强制终止"
  kill -9 "$pid" 2>/dev/null || true
  wait_port_closed || true
  rm -f "$PID_FILE"
  echo "==> 服务已强制停止"
}

cmd_restart() {
  cmd_stop
  cmd_start
}

cmd_status() {
  local pid
  pid="$(pid_from_file)"
  if [ -z "$pid" ]; then
    echo "==> 服务未运行(无 PID 文件)"
    return 0
  fi
  if proc_alive "$pid"; then
    echo "==> 服务运行中: PID $pid,日志 $LOG_FILE"
    if tcp_open; then
      echo "==> 端口 $PORT: 监听中"
    else
      echo "!!> 端口 $PORT: 未监听(进程可能处于异常状态)" >&2
    fi
  else
    echo "==> PID 文件存在但进程 $pid 已不存活(陈旧状态,可用 start 清理)"
  fi
}

cmd_logs() {
  if [ ! -f "$LOG_FILE" ]; then
    echo "!!> 日志不存在: $LOG_FILE(服务尚未启动过)" >&2
    return 1
  fi
  tail -f "$LOG_FILE"
}

case "${1:-}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_restart ;;
  status)  cmd_status ;;
  logs)    cmd_logs ;;
  --help|help|-h)
    echo "用法: bash scripts/service.sh {start|stop|restart|status|logs}" ;;
  "")
    echo "用法: bash scripts/service.sh {start|stop|restart|status|logs}" >&2
    exit 2 ;;
  *)
    echo "未知命令: $1(支持 start/stop/restart/status/logs)" >&2
    exit 2 ;;
esac