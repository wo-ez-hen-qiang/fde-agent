import { listModels } from "@fde/model-gateway";
import type {
  AgentBackend,
  AgentBackendStatus,
  AgentRunRequest,
  ChatStreamEvent,
  DiagnosisResult,
  ScenarioResult,
  StructuredScenarioId,
} from "@fde/shared";
import { buildScenarioAgent } from "../agents.js";
import { runStructured, streamChat } from "../run.js";
import {
  resolvePresalesPhase,
  structuredScenario,
  presalesPhasePrefix,
} from "../scenarios/index.js";
import { agentLog } from "../log.js";

export class ApiAgentBackend implements AgentBackend {
  readonly id = "api" as const;

  async inspect(): Promise<AgentBackendStatus> {
    const enabled = listModels().filter((model) => model.enabled);
    return {
      id: this.id,
      label: "API（model-gateway）",
      installed: true,
      configured: enabled.length > 0,
      available: enabled.length > 0,
      modelLabel: enabled[0]?.label,
      detail: enabled.length > 0 ? `已配置 ${enabled.length} 个模型` : "请在 .env 配置模型 API Key",
    };
  }

  async *streamChat(request: AgentRunRequest): AsyncIterable<ChatStreamEvent> {
    agentLog("backend:api", "streamChat 开始");
    const agent = await buildScenarioAgent("chat", {
      modelAlias: request.model,
      knowledgeBaseId: request.knowledgeBaseId,
    });
    yield* streamChat({ agent, input: request.input, history: request.history });
  }

  async runScenario(
    scenario: StructuredScenarioId,
    request: AgentRunRequest,
  ): Promise<ScenarioResult> {
    const definition = structuredScenario(scenario);
    if (!request.knowledgeBaseId) throw new Error(`${definition.label}需要 knowledgeBaseId`);
    const phase = scenario === "presales" ? resolvePresalesPhase(request) : undefined;
    agentLog(`scenario:${scenario}:start`, `backend=api` + (phase ? ` phase=${phase}` : ""));
    const agent = await buildScenarioAgent(scenario, {
      modelAlias: request.model,
      knowledgeBaseId: request.knowledgeBaseId,
    });
    let input = request.input;
    if (scenario === "presales" && phase) {
      input = `${presalesPhasePrefix(phase)}\n\n输入材料：\n${request.input}`;
    }
    const { output, references } = await runStructured({
      agent,
      input,
      history: request.history,
      knowledgeBaseId: request.knowledgeBaseId,
      label: definition.label,
    });
    console.log(
      `[PRESALES-DEMO] step 12a: definition.parse begin refs=${references.length} outputType=${typeof output}`,
    );
    const result = definition.parse(output, references);
    console.log(
      `[PRESALES-DEMO] step 12b: definition.parse done scenario=${scenario}` +
        (scenario === "presales" && "stage" in result ? ` stage=${result.stage}` : ""),
    );
    agentLog(
      `scenario:${scenario}:done`,
      scenario === "presales" && "stage" in result ? `stage=${result.stage}` : "ok",
    );
    return result;
  }

  async diagnose(request: AgentRunRequest): Promise<DiagnosisResult> {
    return (await this.runScenario("diagnosis", request)) as DiagnosisResult;
  }

  async close(): Promise<void> {}
}
