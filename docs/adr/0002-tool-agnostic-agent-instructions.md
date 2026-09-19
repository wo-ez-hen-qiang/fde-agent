# ADR 0002: 开发规范工具无关（Cursor / Claude / Codex 共用 AGENTS.md）

- 状态：已接受
- 日期：2026-09-19
- 关联：[AGENTS.md](../../AGENTS.md)

## 背景

编码由多种 AI 工具完成：Cursor、Claude Code、Codex CLI。规范如果只放在 `.cursor/skills/`，另外两套工具读不到，会各写各的、立刻漂移。

选项：
1. 各工具各写一份（`.cursor/skills` + `CLAUDE.md` + Codex 专用）
2. **一份正文 + 各工具薄指针**（`AGENTS.md` 为唯一正文）

## 决策

采用选项 2。`AGENTS.md` 是唯一规范正文；Cursor skill 与 `CLAUDE.md` 只做指针。Codex 默认加载仓库根 `AGENTS.md`，无需第三份。

## 理由

- `AGENTS.md` 已成为跨工具的事实标准（Cursor / Codex 原生读取）。
- 改一处、三处生效，避免「Cursor 改了 Claude 不知道」。
- 门禁、VERSION、CHANGELOG 是仓库级约束，与用哪个 IDE 无关。

## 后果

- 正面：Claude / Codex 开箱即遵守同一套设计→确认→编码流程。
- 负面：Cursor 的 skill 触发仍依赖 `.cursor/skills/` 指针（不能删）。
- 规范变更只改 `AGENTS.md`；发现入口文件复制了正文，视为缺陷立即收回。
