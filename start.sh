#!/usr/bin/env bash
# Picsmith 本地一键启动：后端(FastAPI:8000) + 前端(Next.js:3100)
# 在「你自己的终端」里运行：  bash start.sh
# 关掉这个终端窗口 = 关掉服务；Ctrl-C 也会一起停。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "▶ 清理 8000 / 3100 旧进程…"
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
lsof -ti:3100 | xargs kill -9 2>/dev/null || true
sleep 1

echo "▶ 启动后端 http://127.0.0.1:8000 …"
cd "$ROOT/server"
.venv/bin/uvicorn app.main:app --port 8000 > /tmp/picsmith-backend.log 2>&1 &
BACK=$!

echo "▶ 启动前端 http://127.0.0.1:3100 …"
cd "$ROOT/client"
NODE_OPTIONS=--max-old-space-size=4096 npx next dev -p 3100 > /tmp/picsmith-frontend.log 2>&1 &
FRONT=$!

# 任一进程退出就一起收尾，避免半死状态
cleanup() { echo; echo "■ 停止服务…"; kill "$BACK" "$FRONT" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "▶ 等待就绪…"
for i in $(seq 1 30); do
  if curl -s -m 2 http://127.0.0.1:8000/healthz >/dev/null 2>&1 \
     && curl -s -m 2 -o /dev/null http://127.0.0.1:3100 2>/dev/null; then
    echo
    echo "✅ 都起来了："
    echo "   前端  http://127.0.0.1:3100"
    echo "   后端  http://127.0.0.1:8000"
    echo "   日志  /tmp/picsmith-frontend.log  /tmp/picsmith-backend.log"
    echo "   （保持这个窗口开着；Ctrl-C 停止）"
    break
  fi
  sleep 1
done

# 保持前台运行，直到你 Ctrl-C 或关窗口
wait
