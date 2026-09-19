# fde-agent

开源多场景智能体平台：知识库检索（RAG）+ 可插拔场景，全 TypeScript monorepo，本地优先、可私有化部署。
当前场景：**智能工单诊断**；路线图：简历修改、饮食规划、教育现实、劳动力经济、分析建模、电商报价、沙盘推演……

- **Web**：豆包式聊天界面（Next.js 15 全栈），流式输出、历史记录、知识库管理、模型切换
- **CLI**：`fde` 命令行，抽象封装 claude / codex / cursor CLI（订阅额度或 API Key），也可直连 API
- **机器人**：飞书 / 企业微信接入，机器人层抽象，可扩展其它平台
- **模型流量**：别名制切换 GLM / DeepSeek / GPT / Claude / cursor
- **数据**：PGlite 嵌入式 Postgres + pgvector，零外部服务

## 快速开始

```bash
# 1. 环境：Node 22+（已装在 ~/.local/node）+ pnpm 10
export PATH="$HOME/.local/node/bin:$PATH"

# 2. 配置：复制并填写 API Key（至少配一个模型 + embedding）
cp .env.example .env

# 3. 安装依赖
pnpm install

# 4. 启动 web（http://localhost:3000）
pnpm dev:web

# 5. CLI
pnpm dev:cli -- models          # 查看模型流量
pnpm dev:cli -- chat "你好"      # 对话
pnpm dev:cli -- backend list    # 查看后端
```

## 仓库结构

```
apps/web            Next.js 全栈（页面 + /api/* + bot webhook）
apps/cli            fde-agent-cli
packages/shared     领域类型（唯一类型契约来源）
packages/model-gateway  模型别名注册 + LanguageModel 解析
packages/agent-runtime  OpenAI Agents SDK 封装：Agent / Native Tool / MCP / 流式 Runner
packages/data       PGlite：聊天历史 + 知识库 + 向量检索
packages/bot-core   机器人抽象 + 飞书/企微适配器
.cursor/skills/ai-coding  AI 编码规范（设计 → 确认 → 编码）
docs/design/        设计文档
deploy/             docker-compose / k8s
```

## 开发约定

本仓库由 AI coding 驱动，**所有非 trivial 改动先写设计文档（`docs/design/`）并经确认后再编码**，详见 `.cursor/skills/ai-coding/SKILL.md`。

```bash
pnpm typecheck   # 类型检查（提交前必须全绿）
pnpm lint        # eslint
```

## 机器人接入

- 飞书：创建企业自建应用，事件订阅回调填 `https://<你的域名>/api/bots/feishu`，配置 `FEISHU_*` env
- 企业微信：应用消息回调填 `https://<你的域名>/api/bots/wecom`，配置 `WECOM_*` env；群机器人推送用 `WeComWebhookPusher`

## 部署

- 本地/服务器：`pnpm install && pnpm build && pnpm --filter @fde/web start`
- **一键重建**：`pnpm rebuild`（install → clean → build；加 `-- --restart` 构建后自动重启生产服务并自检）
- docker-compose / k8s：见 `deploy/`
