/** 工单诊断：结构化 5 段输出（原有核心场景，行为保持不变）。 */
import { z } from "zod";
import type { DiagnosisResult, ScenarioResult } from "@fde/shared";
import { validateStructured } from "./json.js";
import type { ScenarioDefinition } from "./types.js";

const DIAGNOSIS_INSTRUCTIONS = `你是资深 SRE/技术支持专家，对工单做结构化诊断。
流程：先调用 search_knowledge_base 检索历史相似工单与处理文档（至少一次，可多次换关键词），
再结合工单描述输出结构化诊断。

最终只输出一个 JSON 对象（不要 Markdown 代码围栏），字段固定如下，**每个字段都必须出现**：
- "summary"：一句话结论
- "location"：问题定位，精确到系统/服务/接口级别
- "rootCause"：根因分析，区分直接原因与根本原因
- "solution"：解决方案，给出可执行步骤（含命令/SQL/配置示例，如适用）
- "prevention"：预防措施，覆盖监控、告警与流程层面
- "confidence"：置信度，0 到 1 的数字。检索到高度相似历史工单时 0.7 以上，纯推测时不超过 0.5

（注：JSON 字样必须保留——GLM/OpenAI 的 JSON 模式要求 prompt 中出现 "json"）`;

const DIAGNOSIS_SYSTEM_PROMPT = `你是资深 SRE/技术支持专家。请依据工单和给出的知识库证据输出结构化诊断。
location 精确到系统或环节；rootCause 区分直接原因与根本原因；solution 给出可执行步骤；
prevention 给出监控与流程建议；confidence 必须在 0 到 1 之间。证据不足时降低 confidence，不得编造引用。`;

const DIAGNOSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "location", "rootCause", "solution", "prevention", "confidence"],
  properties: {
    summary: { type: "string" },
    location: { type: "string" },
    rootCause: { type: "string" },
    solution: { type: "string" },
    prevention: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

export const diagnosisOutputSchema = z.object({
  summary: z.string().describe("一句话结论"),
  location: z.string().describe("问题定位：故障发生在哪个系统/环节"),
  rootCause: z.string().describe("根因分析"),
  solution: z.string().describe("解决方案，分步骤"),
  prevention: z.string().describe("预防措施"),
  confidence: z.number().min(0).max(1).describe("置信度 0-1"),
});
export type DiagnosisOutput = z.infer<typeof diagnosisOutputSchema>;

export const diagnosisScenario: ScenarioDefinition = {
  id: "diagnosis",
  label: "工单诊断",
  requiresKnowledgeBase: true,
  instructions: DIAGNOSIS_INSTRUCTIONS,
  systemPrompt: DIAGNOSIS_SYSTEM_PROMPT,
  outputSchema: diagnosisOutputSchema,
  jsonSchema: DIAGNOSIS_JSON_SCHEMA,
  retrieval: {
    queries: (input) => [input],
    task: (input) => `工单：\n${input}\n\n只输出符合约定字段的 JSON，不要使用 Markdown 代码围栏。`,
  },
  parse: (raw, references): DiagnosisResult => {
    const output = validateStructured(diagnosisOutputSchema, raw, "工单诊断");
    return { scenario: "diagnosis", ...output, references, createdAt: Date.now() };
  },
  renderMarkdown: (result: ScenarioResult): string => {
    const diagnosis = result as DiagnosisResult;
    return [
      `**诊断结论**：${diagnosis.summary}`,
      `**问题定位**：${diagnosis.location}`,
      `**根因分析**：${diagnosis.rootCause}`,
      `**解决方案**：${diagnosis.solution}`,
      `**预防措施**：${diagnosis.prevention}`,
    ].join("\n\n");
  },
};
