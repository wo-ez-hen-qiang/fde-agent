# 调研：社区同类项目编码规范（复盘用）

- 日期：2026-09-19
- 作者：伊泽瑞尔 + AI (kimi-k3)
- 目的：对标开源 agent / 聊天产品，决定 fde-agent 还要引入哪些机械校验
- 关联落地：`docs/design/2026-09-19-lint-prettier-deps.md`、提交 `4c19686`

## 1. 对标对象

| 项目 | 为什么对标 | 规范入口 |
|---|---|---|
| [LobeChat](https://github.com/lobehub/lobe-chat) | 全 TS、Next.js、多模型聊天，和我们最像 | `@lobehub/lint` + contributing；循环依赖用 `dpdm`，死代码用 knip |
| [LibreChat](https://github.com/danny-avila/LibreChat) | 多 provider 聊天、workspace 分层 | 根目录 `AGENTS.md`，CONTRIBUTING 指向它；husky + lint-staged |
| OpenHands / Continue / Cline | 编码 agent 生态 | 都认仓库根 `AGENTS.md`（AAIF 事实标准） |

未整包引入 `@lobehub/lint`：绑死别人的 React / i18n / gitmoji 约定，和本仓库规范冲突。

## 2. 对照表（调研当时）

| 能力 | LobeChat | LibreChat | 调研当时的 fde-agent |
|---|---|---|---|
| 规范入口 `AGENTS.md` | 有 | 有（CONTRIBUTING 指向它） | 随后落地，ADR 0002 |
| Prettier 强制格式化 | `@lobehub/lint` + lint-staged | prettier + husky | 装了没强制 |
| lint-staged（只扫改动文件） | husky + lint-staged | husky + lint-staged | 全仓 typecheck + lint，门禁偏重 |
| 循环依赖检测 | `dpdm`（`lint:circular`） | eslint `import/no-cycle` | 口头规范 |
| 死代码 / 未用导出 | knip（`lint:unused`） | — | 无 |
| commitlint | `@lobehub/commitlint-config` | Conventional Commits 约定 | 只有 `AI-Model` trailer |
| TypeScript 严格档 | lobe-lint `typescript: 'strict'` | 中等（甚至关了 no-explicit-any） | recommended |
| 单测基座 | Vitest + CI | Jest / Vitest | 只有 Playwright e2e |
| `import type` | ESLint 强制 | 三组导入 + 禁 inline type | 无 |
| 编辑器 formatOnSave | `.vscode` 推荐 | 有 | 无 |
| Stylelint / remarklint | 有 | — | 无（我们用 Tailwind，CSS-in-JS 收益低） |

## 3. 建议清单（决策当时）

### A 组：低成本、社区标配（推荐先上）

| # | 规范 | 社区出处 | 我们得到什么 | 成本 |
|---|---|---|---|---|
| A1 | Prettier + lint-staged | LobeChat / LibreChat 标配 | 消灭格式 diff；门禁只扫暂存文件 | 低 |
| A2 | 循环依赖 / 分层检测（dpdm 或 dependency-cruiser） | LobeChat `lint:circular`；LibreChat `import/no-cycle` | 「apps→packages 单向」变成机械校验 | 低 |
| A3 | knip 死代码检测 | LobeChat `lint:unused` | AI coding 最容易留未用导出 | 低 |
| A4 | eslint `consistent-type-imports` | LobeChat / LibreChat 都强制 | `import type` 与值导入分开 | 极低 |

### B 组：有价值，需清存量或写首批用例

| # | 规范 | 备注 |
|---|---|---|
| B1 | typescript-eslint strict-type-checked | 能抓 floating promise；初期告警多，建议 warn 起步 |
| B2 | commitlint（Conventional Commits） | 已有 `AI-Model` trailer，再加格式即可 |
| B3 | Vitest + 核心包覆盖率门槛 | 先覆盖 bot-core 加解密、data/splitter、model-gateway 别名解析；挂 CI 不占本机内存 |

### C 组：社区有、当时不建议

| # | 不做的理由 |
|---|---|
| Stylelint | Tailwind + `@theme`，没有 CSS-in-JS 要扫 |
| remarklint | 文档量小 |
| `@lobehub/lint` 整包 | 约定冲突 |
| Changesets / semantic-release | 单应用私有包，VERSION + CHANGELOG + 门禁已够 |
| Biome 替换 eslint | type-checked 规则不如 typescript-eslint，门禁已跑通 |

## 4. 决策与落地结果

**伊泽瑞尔决策（2026-09-19）：先只上 A1、A2、A4。**

落地（`4c19686`，设计文档 `docs/design/2026-09-19-lint-prettier-deps.md`）：

- A1：`prettier.config.mjs` + lint-staged；pre-commit 只扫暂存 ts/tsx/json/css
- A2：选 **dependency-cruiser**（比 dpdm 多一层：还能强制 shared 为叶、packages 不得依赖 apps）。实测 63 模块 / 102 条依赖，零违规
- A4：`@typescript-eslint/consistent-type-imports`，存量 `--fix` 已清

门禁顺序变为：版本三方同步 → lint-staged → `pnpm lint:deps` → typecheck。

**未上（留给后续复盘）**：A3 knip、B1 strict-type-checked、B2 commitlint、B3 Vitest。建议等虚拟机扩容、CI 稳定绿后再开。
