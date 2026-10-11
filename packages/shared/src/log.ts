/** 智能体运行时日志事件（服务端采集；可经 SSE / API 回传前端）。 */
export type AgentLogLevel = "info" | "warn" | "error";

export interface AgentLogEvent {
  ts: number;
  /** 点位标签，如 presales:parse:normalize */
  tag: string;
  level: AgentLogLevel;
  message: string;
}
