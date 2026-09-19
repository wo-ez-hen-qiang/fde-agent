/** Chat domain models shared by web / server / cli / bots. */

import type { DiagnosisResult } from "./diagnosis.js";

export type ChatRole = "user" | "assistant" | "system" | "tool";

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: ChatRole;
  /** Markdown content; assistant messages may embed diagnosis cards. */
  content: string;
  /** Model alias that produced this message, e.g. "glm:glm-4.6". */
  model?: string;
  /** Knowledge base id used for RAG, if any. */
  knowledgeBaseId?: string;
  /** Token/latency metrics for observability. */
  usage?: ChatUsage;
  createdAt: number;
}

export interface ChatUsage {
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
}

export interface ChatSession {
  id: string;
  title: string;
  /** Entry channel: web ui, cli, feishu bot, wecom bot. */
  channel: Channel;
  knowledgeBaseId?: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
}

export type Channel = "web" | "cli" | "feishu" | "wecom" | "api";

/** SSE event envelope streamed by /api/chat. */
export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "tool_call"; name: string; arguments: string }
  | { type: "tool_result"; name: string; result: string }
  | { type: "diagnosis"; diagnosis: DiagnosisResult }
  | { type: "usage"; usage: ChatUsage }
  | { type: "done"; messageId: string }
  | { type: "error"; message: string };

export interface ChatRequest {
  sessionId?: string;
  message: string;
  model?: string;
  knowledgeBaseId?: string;
  channel?: Channel;
  options?: {
    deepThinking?: boolean;
    webSearch?: boolean;
  };
}
