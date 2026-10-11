/** 场景注册表：新增场景只需在此登记一个定义。 */
import type { ScenarioId, StructuredScenarioId } from "@fde/shared";
import { chatScenario } from "./chat.js";
import { diagnosisScenario } from "./diagnosis.js";
import { presalesScenario } from "./presales.js";
import type { ScenarioDefinition } from "./types.js";

export const SCENARIOS: Record<ScenarioId, ScenarioDefinition> = {
  chat: chatScenario,
  diagnosis: diagnosisScenario,
  presales: presalesScenario,
};

export function getScenario(id: ScenarioId): ScenarioDefinition {
  return SCENARIOS[id];
}

/** 结构化场景（有 outputSchema 的），chat 会被排除在外。 */
export function structuredScenario(id: StructuredScenarioId): ScenarioDefinition & {
  outputSchema: NonNullable<ScenarioDefinition["outputSchema"]>;
  parse: NonNullable<ScenarioDefinition["parse"]>;
  renderMarkdown: NonNullable<ScenarioDefinition["renderMarkdown"]>;
} {
  const definition = SCENARIOS[id];
  if (!definition.outputSchema || !definition.parse || !definition.renderMarkdown) {
    throw new Error(`场景 ${id} 不是结构化场景`);
  }
  return definition as ScenarioDefinition & {
    outputSchema: NonNullable<ScenarioDefinition["outputSchema"]>;
    parse: NonNullable<ScenarioDefinition["parse"]>;
    renderMarkdown: NonNullable<ScenarioDefinition["renderMarkdown"]>;
  };
}

export type { ScenarioDefinition, ScenarioRetrieval } from "./types.js";
export { extractJsonObject } from "./json.js";
export { diagnosisScenario, diagnosisOutputSchema, type DiagnosisOutput } from "./diagnosis.js";
export { presalesScenario, presalesPhasePrefix, resolvePresalesPhase } from "./presales.js";
export { chatScenario } from "./chat.js";
