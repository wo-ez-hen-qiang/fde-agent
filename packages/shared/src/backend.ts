import type { ChatStreamEvent } from "./chat.js";
import type { DiagnosisResult } from "./diagnosis.js";
import type { PreSalesResult } from "./presales.js";
import type { ScenarioId, StructuredScenarioId } from "./scenario.js";

export type AgentBackendId = "api" | "claude-cli" | "codex-cli" | "cursor-cli";

/** @deprecated 语义已泛化为「场景」，请用 ScenarioId；保留别名以免大范围改前端。 */
export type ChatMode = ScenarioId;

/** 结构化场景的产出：每种结果自带 `scenario` 判别字段。 */
export type ScenarioResult = DiagnosisResult | PreSalesResult;

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

export interface AgentHistoryItem {
  role: "user" | "assistant";
  content: string;
}

export interface AgentAbortSignal {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export interface AgentRunRequest {
  sessionId?: string;
  providerSessionId?: string;
  input: string;
  history?: AgentHistoryItem[];
  model?: string;
  knowledgeBaseId?: string;
  /**
   * @deprecated 售前请用 presalesPhase。"forceReport=true" 等价于 report。
   */
  forceReport?: boolean;
  /** 售前三步：canvas=生成画布草稿；report=生成 6 段整案。 */
  presalesPhase?: "canvas" | "report";
  signal?: AgentAbortSignal;
}

export interface AgentBackend {
  readonly id: AgentBackendId;
  inspect(): Promise<AgentBackendStatus>;
  streamChat(request: AgentRunRequest): AsyncIterable<ChatStreamEvent>;
  /** 运行一个结构化场景（提示词/Schema/解析/渲染都来自 scenarios 注册表）。 */
  runScenario(scenario: StructuredScenarioId, request: AgentRunRequest): Promise<ScenarioResult>;
  /** @deprecated 等价于 runScenario("diagnosis", request)；保留以免改动 CLI 与机器人的调用点。 */
  diagnose(request: AgentRunRequest): Promise<DiagnosisResult>;
  close(): Promise<void>;
}
