import { aisdk } from "@openai/agents-extensions/ai-sdk";
import { ModelGateway } from "@fde/model-gateway";
import { defaultModelAlias } from "@fde/model-gateway";

/**
 * Bridge: model alias -> AI SDK LanguageModel -> OpenAI Agents SDK model.
 * This is what lets the agent runtime run on GLM / DeepSeek / GPT / Claude
 * interchangeably (traffic switching happens at the alias layer).
 */
export function resolveAgentModel(alias?: string) {
  const gateway = new ModelGateway();
  const languageModel = gateway.resolve(alias ?? defaultModelAlias());
  return aisdk(languageModel);
}
