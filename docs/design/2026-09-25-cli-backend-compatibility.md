# Claude CLI 与 Codex CLI 全入口兼容设计

> 状态：已确认（2026-09-26） | 日期：2026-09-25 | 作者：伊泽瑞尔 + AI (gpt-5)

## 1. 背景

当前 Web、飞书/企微机器人和知识库诊断都直接调用 `@openai/agents + aisdk()`；`apps/cli` 只有 `claude -p`、`codex exec` 的简单 stdout 转发，不能支撑 Web 长会话、结构化诊断和统一错误处理。

本次不删除原 API 后端，而是把 Claude CLI、Codex CLI 做成同级后端。两种 CLI 的上游可由用户配置为官方模型、DeepSeek、GLM 或其他兼容模型，fde-agent 不保存其密钥。

## 2. 目标与非目标

### 目标

1. 终端、Web、飞书/企微机器人、知识库问答和知识库诊断均可选择 `api`、`claude-cli`、`codex-cli`。
2. Web 有后端选择、可用状态、实际模型来源和诊断模式 UI。
3. Claude 使用本机 CLI 的 `stream-json` 机器协议；Codex 使用本机 `codex app-server` 的 stdio JSON-RPC。
4. CLI 的实际模型由各自配置决定，fde-agent 不写死 DeepSeek、GLM 或官方模型。
5. fde-agent 统一完成知识库检索与引用，三种后端获得一致证据。
6. 环境检查接受“API 或任一 CLI 后端可用”，并给新手清楚的安装/配置提示。

### 非目标

- 不删除 `@openai/agents`、AI SDK 或 `model-gateway`，它们继续组成 `api` 后端。
- 不自动改写 `~/.claude/settings.json`、`~/.codex/config.toml`，不复制密钥。
- 不保证所有第三方模型完整支持相应 CLI 的协议，以真实探测结果为准。
- 不允许 Web/机器人借 CLI 执行 Shell、编辑文件或调用未授权工具。
- 不重做机器人平台适配器或知识库管理页面。

## 3. 方案比较与选型

| 方案 | 优点 | 问题 | 结论 |
|---|---|---|---|
| 删除 Agents SDK，全部改 CLI | 表面依赖少 | 破坏 API 部署与现有能力 | 不选 |
| Web 直接跑 `claude -p` / `codex exec` | 快 | 会话、事件、取消与版本兼容弱 | 不选 |
| API 保留，Claude stream-json 与 Codex app-server 并列 | 官方机器协议，适合多入口 | 需要统一 adapter | 采用 |

“运行后端”和“实际模型”分离：

- `api`：现有 Agents SDK + model gateway，继续使用 `<provider>:<model>` 别名。
- `claude-cli`：启动本机 Claude Code 并解析 `stream-json`，读取 Claude 配置。
- `codex-cli`：`codex app-server` 本地 stdio，读取 Codex 配置。

Claude CLI 的非交互模式提供流式 JSON、会话恢复和 JSON Schema；Codex app-server 提供 thread/turn/item、审批和流式事件。Codex 不采用实验性 WebSocket。

## 4. 模块职责与接口

### 4.1 代码归属

后端契约与实现进入 `packages/agent-runtime`，应用层只选择后端：

```text
apps/web ───────┐
apps/cli ───────┼──> packages/agent-runtime ──> api / claude-cli / codex-cli
bot entry ──────┘               │
                                └──> packages/data（会话、知识库）
```

这样遵守 `apps/* → packages/*`，避免 Web、CLI、机器人各写解析器。

### 4.2 共享契约

类型先进入 `packages/shared`：

```ts
export type AgentBackendId = "api" | "claude-cli" | "codex-cli";

export interface AgentBackendStatus {
  id: AgentBackendId;
  label: string;
  installed: boolean;
  configured: boolean;
  available: boolean;
  version?: string;
  modelLabel?: string;
  detail: string;
}

export interface AgentRunRequest {
  sessionId?: string;
  input: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  model?: string;
  knowledgeBaseId?: string;
  signal?: AbortSignal;
}

export interface AgentBackend {
  readonly id: AgentBackendId;
  inspect(): Promise<AgentBackendStatus>;
  streamChat(req: AgentRunRequest): AsyncIterable<ChatStreamEvent>;
  diagnose(req: AgentRunRequest): Promise<DiagnosisResult>;
  close(): Promise<void>;
}
```

`ChatRequest` 增加 `backend` 与 `mode: "chat" | "diagnosis"`。三种 adapter 都输出现有 `ChatStreamEvent`，上层不理解供应商事件。

### 4.3 API adapter

把现有 `buildChatAgent/streamChat/buildDiagnosisAgent/runDiagnosis` 包成 `ApiAgentBackend`，保持行为。模型别名仍只由 `@fde/model-gateway` 解析。

### 4.4 Claude CLI adapter

使用 Claude CLI 的 `--output-format stream-json` 管理进程、流和 session：

- 继承 Claude 登录态、环境变量和用户配置；
- 使用 `--restricted --safe-mode --tools "" --permission-mode dontAsk`，不提供 Bash、文件编辑、Web 抓取等工具；
- 保存 session id，支持 Web/机器人多轮会话；
- 规范化文本、usage、完成和错误事件；
- 用户停止时中止本轮并清理进程。

面向第三方用户的在线服务不得共享个人 claude.ai 登录额度，必须使用符合 Anthropic 条款的服务认证。

### 4.5 Codex CLI adapter

服务端管理一个 `codex app-server` 子进程，通过 stdio JSONL 发送 JSON-RPC：

- initialize 后按 fde 会话保存 Codex `threadId`；
- 每轮创建 turn，将 item/turn 事件规范化；
- sandbox 固定为 `read-only`，审批请求默认拒绝；
- 异常时标记离线，可受控重启一次；
- 不传 FDE 模型别名，模型/custom provider 由 Codex 配置决定。

## 5. 知识库问答与诊断

为兼容 DeepSeek、GLM 等不同实现，第一阶段不依赖 CLI 工具调用，而由 fde-agent 控制检索：

1. 有 `knowledgeBaseId` 时调用 `KnowledgeStore.search`。
2. 把编号、文档、来源和片段作为只读证据交给后端。
3. 普通问答要求标注证据编号；诊断要求固定 JSON 字段。
4. 用 Zod 校验诊断结果；失败只做一次 JSON 修复重试。
5. `DiagnosisResult.references` 只从实际检索结果生成，不信任模型自报引用。

这让三种后端都能做知识库诊断，同时不给 CLI 数据库和文件权限。现有 API agent 工具先保留，后续再评估是否统一前置检索。

## 6. 各入口行为

### Web

- 新增 `GET /api/backends`，只返回状态、版本与模型显示名，不返回密钥或完整配置。
- `/api/chat` 与 `/api/diagnose` 都走同一个 backend resolver。
- 会话创建后锁定 backend；切换时新建会话，防止混用 provider session。

### 飞书/企微机器人

- `FDE_BOT_BACKEND=api|claude-cli|codex-cli` 设置默认后端，默认 `api`。
- 平台会话保存 backend 与 provider session id。
- 后端不可用时回复清楚的故障提示；日志不记录密钥与完整用户输入。

### 命令行

```text
fde backend list
fde backend doctor [api|claude-cli|codex-cli]
fde backend use <id>
fde chat -b <id> "问题"
fde diagnose -b <id> -k <知识库ID> "工单内容"
```

`doctor` 只做无费用的二进制、版本和配置检查；真实调用由用户显式执行。

## 7. 前端交互规格

### 7.1 视觉方向

保留当前简洁聊天布局与明暗主题。输入区上方新增标志性的“路由条”，按 `运行方式 → 模型来源 → 知识库` 展示本轮路径，用状态点加文字表示可用性。只用 Tailwind 和现有语义 token，不用内联样式或装饰性渐变。

### 7.2 页面线框

```text
┌────────会话列表────────┬──────────────────── 对话区 ────────────────────┐
│ + 新对话               │                                                │
│ 工单 A                 │              消息 / 诊断结果卡                 │
│ 工单 B                 │                                                │
│                        ├────────────────────────────────────────────────┤
│                        │ [普通问答] [工单诊断]                           │
│                        │ 运行方式 [API ▾ ●] → 模型 [GLM-4.6 ▾]           │
│                        │ 知识库   [产品运维库 ▾]                         │
│                        │ ┌ 输入问题或粘贴工单…                    [发送] ┐│
└────────────────────────┴─┴──────────────────────────────────────────────┴┘
```

- `api` 显示现有模型下拉框。
- CLI 显示“使用 CLI 当前配置”和探测到的模型名，不伪装成 API 模型列表。
- “工单诊断”必须选择知识库，按钮变为“开始诊断”；结果用诊断卡展示结论、定位、根因、方案、预防、置信度和引用。
- 已有消息时切换后端，确认后保留旧会话并创建新会话。

### 7.3 状态清单

| 状态 | 页面表现 |
|---|---|
| empty | 快速入口；路由条显示默认后端与知识库 |
| loading | 后端显示“检测中”，发送暂时禁用 |
| available | 绿色点 +“可用” |
| not installed | 灰色点 +“未安装”，禁用并给安装说明 |
| not configured | 黄色点 +“未配置”，展开登录/配置说明 |
| streaming | 保留停止按钮与光标，显示当前后端 |
| retrieving | 显示“正在检索知识库”及完成后的引用数量 |
| success | 普通回答或结构化诊断卡 |
| error/timeout | 原位错误、重试和可切换后端入口 |

### 7.4 交互矩阵

| 用户动作/边界 | 系统反馈 |
|---|---|
| 选择可用后端 | 更新模型来源，保存为新会话默认值 |
| 选择未配置后端 | 不发送，展示下一步配置 |
| 有历史时切换后端 | 确认后新建会话 |
| 普通问答未选知识库 | 允许通用对话 |
| 诊断未选知识库 | 禁用“开始诊断”并提示选择 |
| 连续点击发送 | 首次点击后立即禁用 |
| 点击停止 | 中止 HTTP 请求和后端 turn，保留已生成内容 |
| 断网 | 原位提示，可用同一输入重试 |
| CLI 超时/退出 | 显示安全摘要，不暴露敏感 stderr |
| 检索为空 | 明示无相关依据，不生成伪引用 |

### 7.5 响应式、可访问性与高保真

- 窄屏路由条换为两行；触控目标不小于 40px。
- 状态同时使用文字和颜色；控件有 label，支持键盘。
- 本次沿用既有视觉语言，暂不另做高保真 HTML。若确认时要求整体改版，再先在 `docs/prototypes/` 做单文件原型，确认后再写 React。

## 8. 数据模型与配置

`ChatSession` 增加：

```ts
backend: AgentBackendId;
providerSessionId?: string;
```

数据库 session 表增加对应字段；旧数据迁移时 `backend` 默认为 `api`。CLI 消息可记录探测到的模型显示名，但不伪造 `<provider>:<model>` 别名。

新增环境变量：

- `FDE_DEFAULT_BACKEND`：Web/CLI 默认后端，默认 `api`；
- `FDE_BOT_BACKEND`：机器人默认后端，默认 `api`；
- `FDE_CLAUDE_BIN`、`FDE_CODEX_BIN`：可执行文件路径覆盖；
- `FDE_CLI_TIMEOUT_MS`：单轮超时。

同步 `.env.example` 与 runbook，不加入真实密钥。`~/.fde/config.json` 只保存客户端默认选择。

## 9. 安全与部署

- CLI 运行在 Web/机器人服务所在主机，不能调用另一台电脑上的 CLI。
- 个人本地部署可复用本机登录态；团队/公网服务必须用合规的服务认证。
- 子进程参数使用数组，不经过 shell；日志只记 backend、事件类型和安全摘要。
- Claude 不开放危险工具；Codex 固定只读并拒绝审批。
- status API 不返回 token、完整环境变量、完整配置或敏感路径。

## 10. 影响面

- `packages/shared`：backend、请求、session 类型。
- `packages/agent-runtime`：registry、三种 adapter、统一检索和诊断。
- `packages/data`：session 迁移。
- `apps/web`：backend API、chat/diagnose 切换、路由条、诊断 UI。
- `packages/bot-core` / `apps/web/src/lib/server.ts`：机器人选择统一后端。
- `apps/cli`：共享 registry、backend doctor、diagnose `-b`。
- `scripts/doctor.sh`、`.env.example`、runbook：CLI 可用性与新手说明。

## 11. 实施与验收

1. 共享类型、registry、adapter、parser 单测。
2. 接入 CLI chat/diagnose，真实执行 Claude/Codex 路径。
3. 数据迁移、Web API 与前端。
4. 机器人接入与模拟平台事件冒烟。
5. Playwright 覆盖后端选择、诊断必选知识库、停止、不可用和重试。
6. 启动 Web，真实命中 `/api/chat`、`/api/diagnose`。
7. 运行 `pnpm typecheck && pnpm lint`。

验收要求：

- Web、CLI、机器人、知识库诊断都走统一 resolver。
- API 不回退；Claude/Codex 可流式输出与取消。
- CLI 上游改为 DeepSeek/GLM 不需改 fde-agent 代码。
- 诊断通过结构校验，引用只来自检索。
- UI 覆盖 empty/loading/error/streaming/success。

## 12. 当前环境与确认点

- Codex CLI：`codex-cli 0.154.0-alpha.6.2`。
- Claude CLI：`2.1.282 (Claude Code)`，已安装但尚未登录或配置上游。
- 当前 `.env` 无直连模型 API Key；完成后 doctor 应允许已配置 CLI 满足条件。
- 建议默认：本机个人使用可选 CLI；团队/公网部署仍默认 `api`，显式配置后才启用 CLI。

编码前需确认：是否接受“所有入口均支持三种后端，但团队/公网部署默认 API，CLI 必须显式启用”。

## 13. 参考资料

- [OpenAI Agents SDK](https://developers.openai.com/api/docs/guides/agents/sdk)
- [Codex app-server](https://learn.chatgpt.com/docs/app-server)
- [Codex 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)
- [Claude Code CLI 参考](https://code.claude.com/docs/en/cli-usage)
- [Claude Code LLM gateway](https://code.claude.com/docs/en/llm-gateway-connect)
- [DeepSeek 接入 Claude Code](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code/)
- [DeepSeek 接入 Codex](https://api-docs.deepseek.com/quick_start/agent_integrations/codex/)
- [智谱 Coding Tool Helper](https://docs.bigmodel.cn/cn/coding-plan/extension/coding-tool-helper)
