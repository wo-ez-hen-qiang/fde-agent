#!/usr/bin/env bash
# fde-agent 发布脚本：VERSION -> git tag -> GitHub Release
#
# 前置：工作区干净；VERSION/package.json/CHANGELOG 三方一致（门禁已保证）；
#       gh 已登录（见 docs/runbook/dev-environment-setup.md）。
# 用法: scripts/release.sh          # 按当前 VERSION 发版
set -euo pipefail

cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$HOME/.local/node/bin:$PATH"

VER=$(tr -d '[:space:]' < VERSION)
TAG="v$VER"

if [ -n "$(git status --porcelain)" ]; then
  echo "[release] 工作区有未提交改动，先提交" >&2
  exit 1
fi

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "[release] tag $TAG 已存在；要发新版请先 bump VERSION + package.json + CHANGELOG" >&2
  exit 1
fi

# 从 CHANGELOG 提取本版本小节作为 release notes
NOTES=$(awk "/^## \[$VER\]/{flag=1;next} /^## \[/{flag=0} flag" CHANGELOG.md | sed '/^\s*$/d')
if [ -z "$NOTES" ]; then
  echo "[release] CHANGELOG.md 里找不到 ## [$VER] 小节" >&2
  exit 1
fi

git tag -a "$TAG" -m "fde-agent $TAG"
git push origin main "$TAG"

echo "$NOTES" | gh release create "$TAG" --title "$TAG" --notes-file -

echo "[release] 已发布 $TAG"
