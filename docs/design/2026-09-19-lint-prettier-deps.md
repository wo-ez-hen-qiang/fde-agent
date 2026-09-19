# A1/A2/A4 编码规范引入

> 状态：已确认 | 日期：2026-09-19 | 作者：伊泽瑞尔 + AI (kimi-k3)
> 范围：Prettier + lint-staged、依赖方向机械校验、consistent-type-imports

## 目标

把社区标配三项变成机械校验，不改业务逻辑。

| 编号 | 做什么 | 不做 |
|---|---|---|
| A1 | Prettier 统一格式；pre-commit 用 lint-staged 只扫暂存文件 | 不换 husky（继续 `.githooks`） |
| A2 | dependency-cruiser：禁循环依赖 + 强制 `apps → packages` 单向 | 不上 knip / commitlint / Vitest |
| A4 | `@typescript-eslint/consistent-type-imports` | 不上完整 eslint-plugin-import 分组 |

## 门禁顺序（pre-commit）

1. 版本三方同步（不变）
2. `pnpm exec lint-staged`（prettier + eslint --fix，仅暂存文件）
3. `pnpm lint:deps`（dependency-cruiser，快）
4. `pnpm typecheck`（全仓，已有）

全仓 `pnpm lint` 仍留给 CI / 本地手跑。低内存机器不跑 next build。
