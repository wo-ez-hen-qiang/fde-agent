import { buildChatAgent, streamChat } from "@fde/agent-runtime";
import { listModels } from "@fde/model-gateway";
import type { AgentBackend, BackendChatRequest } from "./types.js";

/**
 * Direct-API backend: runs the same agent runtime as the web app,
 * on whatever model alias is configured (GLM/DeepSeek/GPT/Claude).
 */
export class ApiBackend implements AgentBackend {
  readonly id = "api";
  readonly label = "直连 API（model-gateway）";
  readonly kind = "api" as const;

  async isAvailable(): Promise<boolean> {
    return listModels().some((m) => m.enabled);
  }

  async *chat(req: BackendChatRequest): AsyncIterable<string> {
    try {
      const agent = await buildChatAgent({
        modelAlias: req.model,
        knowledgeBaseId: req.knowledgeBaseId,
      });
      for await (const event of streamChat({ agent, input: req.message })) {
        if (event.type === "delta") yield event.text;
        else if (event.type === "tool_call") yield `\n[调用工具: ${event.name}]\n`;
        else if (event.type === "error") yield `\n[错误] ${event.message}\n`;
      }
    } catch (err) {
      yield `[错误] ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}
