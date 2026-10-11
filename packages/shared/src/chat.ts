/** Chat domain models shared by web / server / cli / bots. */

import type { DiagnosisResult } from "./diagnosis.js";
import type { AgentBackendId, ScenarioResult } from "./backend.js";
import type { ScenarioId } from "./scenario.js";

export type ChatRole = "user" | "assistant" | "system" | "tool";

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: ChatRole;
  /** Markdown content; assistant messages may embed scenarios' structured cards. */
  content: string;
  /** 产出这条消息的场景（chat 时为空）。 */
  scenario?: ScenarioId;
  /** 结构化场景的原始结果（diagnosis / presales）。 */
  scenarioResult?: ScenarioResult;
  /** @deprecated 旧列回退映射的产物；新消息请读 scenarioResult。 */
  diagnosis?: DiagnosisResult;
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
  /** Runtime used for this conversation. Existing rows default to api. */
  backend: AgentBackendId;
  /** 本会话使用的场景（普通问答 / 工单诊断 / 售前方案）。旧行默认为 chat。 */
  scenario: ScenarioId;
  /** Opaque Claude/Codex session id; never exposed to browser clients. */
  providerSessionId?: string;
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
  | { type: "backend_session"; sessionId: string; model?: string }
  | { type: "log"; tag: string; level: "info" | "warn" | "error"; message: string }
  | { type: "done"; messageId: string }
  | { type: "error"; message: string };

export interface ChatRequest {
  sessionId?: string;
  message: string;
  model?: string;
  backend?: AgentBackendId;
  /** 本次请求走哪个场景（默认 chat）。 */
  scenario?: ScenarioId;
  knowledgeBaseId?: string;
  channel?: Channel;
  options?: {
    deepThinking?: boolean;
    webSearch?: boolean;
  };
}
