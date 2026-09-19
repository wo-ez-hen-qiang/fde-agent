#!/usr/bin/env bash
# fde-agent 环境自检（ai-coding skill 载入时执行；新用户上手引导）
#
# 用法:
#   scripts/doctor.sh            # 标记有效则跳过，否则全量检查
#   scripts/doctor.sh --force    # 忽略标记，强制全量检查
#
# 检查项: Node>=22 / pnpm / 依赖已安装 / .env 含至少一个模型 key / git 门禁已挂载
# 全部通过写标记 .env-check.ok（gitignored），后续运行秒过。
set -u

cd "$(dirname "$0")/.."
export PATH="$HOME/.local/node/bin:$PATH"

MARKER=".env-check.ok"
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

# 标记仍有效（node/pnpm 版本未漂移 + node_modules 与 .env 仍在）则跳过
if [ "$FORCE" = "0" ] && [ -f "$MARKER" ]; then
  MARK_NODE="" MARK_PNPM="" MARK_DATE=""
  . "$MARKER"
  if [ "$MARK_NODE" = "$(node -v 2>/dev/null || echo none)" ] \
     && [ "$MARK_PNPM" = "$(pnpm -v 2>/dev/null || echo none)" ] \
     && [ -d node_modules ] && [ -f .env ]; then
    echo "[doctor] 环境检查已通过（$MARK_DATE），跳过。强制重跑：pnpm doctor -- --force"
    exit 0
  fi
  echo "[doctor] 环境有变化，重新检查..."
fi

echo "[doctor] fde-agent 环境自检"
fail=0
ok()  { echo "  ✅ $*"; }
bad() { echo "  ❌ $*"; fail=1; }

# 1. Node >= 22
if command -v node >/dev/null 2>&1; then
  NV=$(node -v); MAJOR=${NV#v}; MAJOR=${MAJOR%%.*}
  if [ "$MAJOR" -ge 22 ]; then
    ok "Node $NV"
  else
    bad "Node $NV 过低（需要 >=22），见 docs/runbook/dev-environment-setup.md"
  fi
else
  bad "未找到 node（需要 >=22），见 docs/runbook/dev-environment-setup.md"
fi

# 2. pnpm
if command -v pnpm >/dev/null 2>&1; then
  ok "pnpm $(pnpm -v)"
else
  bad "未找到 pnpm：corepack enable && corepack prepare pnpm@10 --activate"
fi

# 3. 依赖已安装
if [ -d node_modules ]; then
  ok "依赖已安装"
else
  bad "依赖未安装：pnpm install"
fi

# 4. .env 存在且至少一个模型 key 非空
if [ -f .env ]; then
  if grep -qE "^(GLM|DEEPSEEK|OPENAI|ANTHROPIC)_API_KEY=.+" .env; then
    ok ".env 已配置模型 key"
  else
    bad ".env 没有任何模型 API key（至少配一个，参照 .env.example）"
  fi
else
  bad "缺少 .env：cp .env.example .env 并填入 API key"
fi

# 5. git 门禁已挂载
if [ "$(git config core.hooksPath 2>/dev/null || true)" = ".githooks" ]; then
  ok "git 门禁已挂载"
else
  bad "git 门禁未挂载：git config core.hooksPath .githooks（或重跑 pnpm install）"
fi

if [ "$fail" = "1" ]; then
  echo
  echo "[doctor] 存在未通过项，按提示修复后复跑：pnpm doctor -- --force"
  exit 1
fi

{
  echo "MARK_NODE=$(node -v)"
  echo "MARK_PNPM=$(pnpm -v)"
  echo "MARK_DATE=$(date '+%F_%T')"
} > "$MARKER"
echo
echo "[doctor] 全部通过 ✅（已写标记 $MARKER，后续自动跳过）"
