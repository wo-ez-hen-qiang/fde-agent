---
name: ai-coding
description: Enforces fde-agent's AI coding workflow - design doc first, owner confirmation, then implementation - plus this repo's TypeScript monorepo coding standards. Use for any new feature, module, or non-trivial code change in this repository.
---

# AI Coding 规范（fde-agent）

本仓库所有非 trivial 改动必须遵守以下流程。 trivial 改动（修 bug、文案、样式微调、配置修正）可直接改。

## 核心流程：设计 → 确认 → 编码

```
Task Progress:
- [ ] 1. 设计：写设计文档到 docs/design/yyyy-mm-dd-<主题>.md
- [ ] 2. 确认：向伊泽瑞尔呈现文档要点，获得明确确认
- [ ] 3. 编码：按文档实现，不偏离已确认的架构
- [ ] 4. 冒烟测试：实际运行关键路径（启动服务/调 API/跑命令），不许只看编译通过
- [ ] 5. 验收：typecheck + lint 全绿，向伊泽瑞尔汇报冒烟结果
```

**Step 1：设计文档**。包含：目标/非目标、方案对比与选型理由、模块职责与接口（关键类型签名）、数据模型变更、时序图（复杂流程用 mermaid）、对现有代码的影响面。文档分类与命名规范见 [docs/README.md](../../../docs/README.md)（设计文档 `docs/design/YYYY-MM-DD-<主题>.md`；难撤销的选型另补 `docs/adr/NNNN-<标题>.md`）。**文档顶部必须标注作者，AI 参与的要写明模型名**，如 `作者：伊泽瑞尔 + AI (kimi-k3)`。

**Step 2：确认**。呈现文档要点摘要 + 开放问题，等伊泽瑞尔明确说「确认/可以/go」再动手。确认后若需求变更，先更新设计文档。

**Step 3：编码**。遵守下方编码规范。

**Step 4：冒烟测试**。把功能真正跑起来验证关键路径：服务端改动至少命中一次对应 API（curl），前端改动至少构建通过并说明页面验证点，CLI 改动至少真实执行一次命令。禁止只编译通过就宣布完成。

**Step 5：验收**。运行 `pnpm typecheck && pnpm lint`，必须全绿；在回复中汇报冒烟测试的实际输出。

## 前端改动的补充：交互规格

设计文档涉及前端时，必须包含「交互规格」一节，否则不允许进入编码：

1. **页面线框**：ASCII 线框，或参考产品截图 + 标注差异点（本项目对标豆包）。
2. **状态清单**：每个视图的 empty / loading / error / streaming / 成功态长什么样。
3. **交互矩阵**：用户动作 → 系统反馈，含边界情况（断网、超时、空结果、并发点击）。
4. **高保真需求**：视觉效果拿不准时，先在 `docs/prototypes/` 出一个单文件 HTML 原型，伊泽瑞尔确认视觉效果后再落成 React 组件；禁止直接写大段样式代码再返工。

## 编码规范

1. **类型契约**：跨包数据结构先进 `packages/shared`，禁止重复定义；导出一律走包的 `index.ts`。
2. **依赖方向**：只允许 `apps/* → packages/*`；`shared` 不依赖内部包；禁止循环依赖。
3. **配置**：密钥/端点/开关只读 `process.env`，新增变量同步 `.env.example`；禁止硬编码密钥。
4. **模型切换**：代码里只允许出现模型别名（`<provider>:<model>`），解析一律走 `@fde/model-gateway`，禁止直接 new provider SDK。
5. **错误处理**：异步边界必须 try/catch 并返回结构化错误（SSE 用 `{type:"error"}` 事件，API 用 `{error}` JSON）；禁止吞异常。
6. **日志**：服务端用 `console.error/warn` 带模块前缀（如 `[bot-core]`），禁止打印密钥与完整用户输入。
7. **样式**：禁止内联样式（`style={{}}`）。一律使用 Tailwind 工具类；主题相关（颜色/背景/边框）使用 `globals.css` 中 `@theme inline` 注册的语义 token（如 `bg-primary`、`text-secondary`、`border-border`），新增 token 先在 globals.css 定义再使用。
8. **提交**：Conventional Commits，如 `feat(bot-core): add feishu adapter`。**里程碑（最终）提交必须同步三处版本信息**：① 根目录 `VERSION` 文件；② 根 `package.json` 的 `version`；③ `CHANGELOG.md` 顶部新增版本小节（遵循 Keep a Changelog：`Added/Changed/Fixed/Removed` 分类，写清发布说明与变更点）。版本号变更写进 commit message。
9. **git 门禁**：每次提交自动执行 `.githooks/pre-commit`（VERSION 同步检查 → `pnpm typecheck` → `pnpm lint`），任一失败则拒绝提交。禁止用 `--no-verify` 绕过；紧急情况必须使用时，在 commit message 中注明原因并尽快补绿。新机器克隆后 `pnpm install` 会自动挂上门禁（`prepare` 脚本设置 `core.hooksPath`）。
10. **模型署名**：commit message 必须带 trailer `AI-Model: <模型名>`（如 `AI-Model: kimi-k3`；人工提交写 `AI-Model: human`），由 `.githooks/commit-msg` 机械强制。设计文档同理，顶部作者行写明模型名。

## 技术栈速查

Next.js 15 App Router + React 19 + Tailwind v4（apps/web）；`@openai/agents` + `aisdk()` 桥接（packages/agent-runtime）；PGlite + pgvector（packages/data）；AI SDK v5 providers（packages/model-gateway）。新增依赖前先查是否已有包提供该能力。
