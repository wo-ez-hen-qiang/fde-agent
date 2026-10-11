# 智能体实时日志与关键节点打标

> 状态：已确认（2026-09-30）| 日期：2026-09-30 | 作者：伊泽瑞尔 + AI (Composer)

## 目标

1. 服务端关键路径打带前缀标签的日志（stderr：`console.warn` / `console.error`）。
2. 同一次请求内采集日志；聊天走 SSE `type:"log"`，售前/诊断走响应体 `logs[]`。
3. Web 底部可折叠日志条，便于 FDE 排障（如字段归一化）。

## 非目标

- 不做日志落库 / 外部 ELK；不打印密钥与完整用户输入。

## 标签约定

`[域:动作]` 或 `[域:子域:动作]`，例如：

- `scenario:presales:start` / `scenario:presales:canvas` / `scenario:presales:done`
- `presales:parse:normalize`
- `kb:search`
- `backend:api` / `backend:claude-cli` / …

## 接口

```ts
interface AgentLogEvent {
  ts: number;
  tag: string;
  level: "info" | "warn" | "error";
  message: string;
}
// ChatStreamEvent 增加 { type: "log"; tag; level; message }
```

采集：`AsyncLocalStorage` + `runWithAgentLogs`；`agentLog(tag, message, level?)`。

## UI

底部 `AgentLogDock`：默认收起只显示最新一条；展开看本会话最近 N 条。
