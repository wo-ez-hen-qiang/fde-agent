# 更新日志

本文件记录 fde-agent 的版本发布说明与变更历史。
格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

维护规则（ai-coding skill 第 8 条）：里程碑提交必须同步 `VERSION` + 本文件顶部新增版本小节，git 门禁机械校验三者（VERSION / package.json / CHANGELOG）一致。

## [Unreleased]

### Added

- 开发规范工具无关：`AGENTS.md` 为唯一正文；Cursor skill / `CLAUDE.md` 只做指针（ADR 0002）。Cursor / Claude Code / Codex CLI 共用同一套设计→确认→编码流程。

## [0.1.0] - 2026-09-19

地基里程碑（M0）：monorepo 骨架与全链路冒烟通过。

### Added

- **monorepo**：pnpm workspace，`apps/web`、`apps/cli` + 5 个 packages；全仓 TypeScript strict。
- **packages/shared**：领域类型唯一契约（会话/消息/诊断/知识库/Provider/Bot）。
- **packages/model-gateway**：模型别名制流量切换（`<provider>:<model>`），GLM/DeepSeek 走 OpenAI 兼容端点，GPT/Claude 走官方 SDK；凭据探测自动 enable/disable。
- **packages/agent-runtime**：OpenAI Agents SDK 封装 —— 聊天 Agent（流式）、诊断 Agent（zod 结构化输出：问题定位/根因分析/解决方案/预防措施/置信度）、知识库检索 Native Tool、MCP server 管理器（stdio/http，支持 Python server）。
- **packages/data**：PGlite（嵌入式 Postgres）+ pgvector 数据层 —— 聊天历史、知识库 CRUD、文档切分入库、余弦相似度检索；GLM embedding-3。
- **packages/bot-core**：机器人层抽象（`BotAdapter` 接口 + 统一事件模型 + Dispatcher 去重/@触发），飞书适配器（事件回调 + 发消息），企业微信双模式（应用回调 AES 加解密 + 群机器人 webhook 推送）。
- **apps/web**：Next.js 15 全栈 —— 豆包式聊天界面（侧边栏历史/流式渲染/停止重试/模型与知识库选择器）、9 个 API 路由（chat SSE、sessions、knowledge、diagnose、models、bots webhook）。
- **apps/cli**：`fde` 命令行 —— 后端抽象（claude/codex/cursor CLI 子进程封装，订阅额度/API Key 双模式 + 直连 API 后端），命令：chat / diagnose / backend / models。
- **ai-coding skill**（`.cursor/skills/ai-coding`）：设计 → 确认 → 编码工作流；前端交互规格要求；编码规范（禁内联样式、类型契约、依赖方向、env 配置等 9 条）。
- **设计文档**：`docs/design/2026-09-19-foundation.md`（已确认，含主聊天页交互规格）。
- **工程化**：git 门禁（pre-commit：版本三方同步 + typecheck + lint）、`VERSION` 文件、eslint 9 flat config、部署骨架（Dockerfile / docker-compose / k8s manifest）。

### 已知限制

- 知识库管理仅有 API，无管理界面（M1）。
- 诊断卡片前端组件未实现，诊断结果以 Markdown 消息呈现（M1）。
- 机器人 webhook 未接真实平台联调（M3）。
