#!/usr/bin/env bash
# fde-agent 一键重新构建
#
# 用法:
#   scripts/rebuild.sh                  # install -> clean -> build
#   scripts/rebuild.sh --skip-install   # 跳过依赖安装
#   scripts/rebuild.sh --restart        # 构建成功后重启生产服务并自检
#
set -euo pipefail

cd "$(dirname "$0")/.."
export PATH="$HOME/.local/node/bin:$PATH"

RESTART=0
SKIP_INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --restart) RESTART=1 ;;
    --skip-install) SKIP_INSTALL=1 ;;
    -h|--help)
      echo "用法: scripts/rebuild.sh [--skip-install] [--restart]"
      exit 0
      ;;
    *) echo "未知参数: $arg（--help 查看用法）" >&2; exit 1 ;;
  esac
done

step() { echo; echo "==> $*"; }

# 低内存保护：next build 峰值约 2GB。可用内存不足时拒绝构建，
# 防止把整机（含 SSH/Cursor 转发通道）拖死。虚拟机扩容后此保护自动放行。
AVAIL_MB=$(free -m | awk '/^Mem:/ {print $7}')
if [ "$AVAIL_MB" -lt 2048 ]; then
  echo "[rebuild] 拒绝构建：可用内存 ${AVAIL_MB}MB < 2048MB，next build 会 OOM。"
  echo "  临时方案: pnpm dev:web（开发模式，按需编译，内存占用低）"
  echo "  根治方案: 扩大虚拟机内存，或加 swap，见 docs/runbook/dev-environment-setup.md"
  exit 1
fi

if [ "$SKIP_INSTALL" = "1" ]; then
  step "1/3 跳过依赖安装"
else
  step "1/3 安装依赖"
  pnpm install
fi

step "2/3 清理旧构建产物"
pnpm --filter @fde/web run clean

step "3/3 生产构建"
pnpm --filter @fde/web run build

if [ "$RESTART" = "1" ]; then
  step "重启生产服务"
  pkill -f "next-server" 2>/dev/null || true
  sleep 1
  (cd apps/web && nohup pnpm start > /tmp/fde-prod.log 2>&1 &)
  sleep 5
  CODE=$(curl -s -m 15 -o /dev/null -w "%{http_code}" http://localhost:3000/ || true)
  if [ "$CODE" = "200" ]; then
    echo "服务已重启: http://localhost:3000 (http 200)"
  else
    echo "服务未就绪（http ${CODE:-000}），日志: /tmp/fde-prod.log" >&2
    exit 1
  fi
fi

step "完成"
