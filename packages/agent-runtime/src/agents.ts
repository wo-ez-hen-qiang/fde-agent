import { Agent } from "@openai/agents";
import type { ScenarioId } from "@fde/shared";
import { resolveAgentModel } from "./model.js";
import { nativeTools } from "./tools.js";
import type { McpManager } from "./mcp.js";
import { getScenario } from "./scenarios/index.js";

export interface BuildAgentOptions {
  modelAlias?: string;
  knowledgeBaseId?: string;
  mcpManager?: McpManager;
}

/**
 * 按场景构造 Agent（api 后端）。提示词来自场景注册表。
 *
 * 两个关键点：
 * 1. `knowledgeBaseId` 必须写进 instructions —— 检索工具要求模型自己传库 id，而模型无从
 *    得知真实 id。此前该参数声明了却从未使用，导致 api 后端检索恒为空、引用恒为 0
 *    （静默地"凭自己知识作答"，看起来却正常）。
 * 2. **不设 `outputType`**：结构化输出统一走「提示词要求 JSON + 自己解析」（与 claude/codex
 *    路径一致）。实测经 aisdk 桥接到 GLM 时，SDK 的结构化输出校验会失败且报错被脱敏
 *    （`REDACTED_FINAL_OUTPUT_ERROR_MESSAGE`），既不可用也不可诊断。
 */
export async function buildScenarioAgent(scenario: ScenarioId, opts: BuildAgentOptions) {
  console.log(
    `[PRESALES-DEMO] step 8: buildScenarioAgent scenario=${scenario} modelAlias=${opts.modelAlias ?? "(default)"} kb=${opts.knowledgeBaseId ?? ""}`,
  );
  const definition = getScenario(scenario);
  const mcpServers = opts.mcpManager ? await opts.mcpManager.connect() : [];
  const instructions = opts.knowledgeBaseId
    ? `${definition.instructions}

# 本轮知识库
本轮知识库 ID 固定为 ${opts.knowledgeBaseId}；调用 search_knowledge_base 时必须使用该 ID，不要自行猜测或改写。`
    : definition.instructions;

  return new Agent({
    name: `fde-${scenario}`,
    instructions,
    model: resolveAgentModel(opts.modelAlias),
    tools: nativeTools,
    mcpServers,
  });
}

/** @deprecated 用 buildScenarioAgent("chat", …)。 */
export async function buildChatAgent(opts: BuildAgentOptions) {
  return buildScenarioAgent("chat", opts);
}

/** @deprecated 用 buildScenarioAgent("diagnosis", …)。 */
export async function buildDiagnosisAgent(opts: BuildAgentOptions) {
  return buildScenarioAgent("diagnosis", opts);
}
