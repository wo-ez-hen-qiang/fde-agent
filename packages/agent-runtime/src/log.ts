/**
 * 带标签的运行时日志：stderr + 可选请求内采集（供 SSE / API 回传）。
 * 禁止写入密钥或完整用户输入。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentLogEvent, AgentLogLevel } from "@fde/shared";

const store = new AsyncLocalStorage<{
  events: AgentLogEvent[];
  onEvent?: (event: AgentLogEvent) => void;
}>();

const MAX_EVENTS = 200;

export function agentLog(tag: string, message: string, level: AgentLogLevel = "info"): void {
  const event: AgentLogEvent = { ts: Date.now(), tag, level, message };
  const line = `[${tag}] ${message}`;
  if (level === "error") console.error(line);
  else console.warn(line);

  const ctx = store.getStore();
  if (!ctx) return;
  ctx.events.push(event);
  if (ctx.events.length > MAX_EVENTS) ctx.events.splice(0, ctx.events.length - MAX_EVENTS);
  ctx.onEvent?.(event);
}

/** 在一次请求作用域内采集日志；可选 onEvent 做实时推送（如 SSE）。 */
export async function runWithAgentLogs<T>(
  fn: () => Promise<T>,
  onEvent?: (event: AgentLogEvent) => void,
): Promise<{ result: T; logs: AgentLogEvent[] }> {
  const events: AgentLogEvent[] = [];
  const result = await store.run({ events, onEvent }, fn);
  return { result, logs: events };
}
