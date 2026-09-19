import { Agent } from "@openai/agents";
import { z } from "zod";
import { resolveAgentModel } from "./model.js";
import { nativeTools } from "./tools.js";
import type { McpManager } from "./mcp.js";

/** Structured diagnosis output - rendered as a card in the UI. */
export const diagnosisOutputSchema = z.object({
  summary: z.string().describe("一句话结论"),
  location: z.string().describe("问题定位：故障发生在哪个系统/环节"),
  rootCause: z.string().describe("根因分析"),
  solution: z.string().describe("解决方案，分步骤"),
  prevention: z.string().describe("预防措施"),
  confidence: z.number().min(0).max(1).describe("置信度 0-1"),
});
export type DiagnosisOutput = z.infer<typeof diagnosisOutputSchema>;

const CHAT_INSTRUCTIONS = `你是 fde-agent，一个基于知识库的智能工单诊断助手。
工作方式：
1. 理解用户描述的问题（通常是工单/故障/异常）。
2. 当用户选择了知识库，或问题明显需要历史经验时，调用 search_knowledge_base 检索相关历史工单与文档。
3. 基于检索结果 + 自身知识给出诊断，引用检索到的文档。
4. 回答使用 Markdown，结构清晰，必要时分点、给命令或代码。
当用户明确要求"诊断"时，输出应包含：问题定位、根因分析、解决方案、预防措施。`;

const DIAGNOSIS_INSTRUCTIONS = `你是资深 SRE/技术支持专家，对工单做结构化诊断。
流程：先调用 search_knowledge_base 检索历史相似工单与处理文档（至少一次，可多次换关键词），
再结合工单描述输出结构化诊断。要求：
- location 精确到系统/服务/接口级别
- rootCause 区分直接原因与根本原因
- solution 给出可执行步骤（含命令/SQL/配置示例，如适用）
- prevention 给出监控、告警、流程层面的建议
- confidence 诚实评估：检索到高度相似历史工单时 0.7 以上，纯推测时不超过 0.5`;

export interface BuildAgentOptions {
  modelAlias?: string;
  knowledgeBaseId?: string;
  mcpManager?: McpManager;
}

/** General chat agent (streaming markdown answers, RAG via native tool + MCP). */
export async function buildChatAgent(opts: BuildAgentOptions) {
  const mcpServers = opts.mcpManager ? await opts.mcpManager.connect() : [];
  return new Agent({
    name: "fde-agent",
    instructions: CHAT_INSTRUCTIONS,
    model: resolveAgentModel(opts.modelAlias),
    tools: nativeTools,
    mcpServers,
  });
}

/** Diagnosis agent with structured output (zod schema). */
export async function buildDiagnosisAgent(opts: BuildAgentOptions) {
  const mcpServers = opts.mcpManager ? await opts.mcpManager.connect() : [];
  return new Agent({
    name: "fde-diagnosis",
    instructions: DIAGNOSIS_INSTRUCTIONS,
    model: resolveAgentModel(opts.modelAlias),
    tools: nativeTools,
    mcpServers,
    outputType: diagnosisOutputSchema,
  });
}
