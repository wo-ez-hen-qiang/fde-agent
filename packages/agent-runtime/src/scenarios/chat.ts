/** 普通问答：自由文本 + 流式输出（无结构化 schema）。 */
import type { ScenarioDefinition } from "./types.js";

const CHAT_INSTRUCTIONS = `你是 fde-agent，一个基于知识库的智能工单诊断助手。
工作方式：
1. 理解用户描述的问题（通常是工单/故障/异常）。
2. 当用户选择了知识库，或问题明显需要历史经验时，调用 search_knowledge_base 检索相关历史工单与文档。
3. 基于检索结果 + 自身知识给出诊断，引用检索到的文档。
4. 回答使用 Markdown，结构清晰，必要时分点、给命令或代码。
当用户明确要求"诊断"时，输出应包含：问题定位、根因分析、解决方案、预防措施。`;

const CHAT_SYSTEM_PROMPT = `你是 fde-agent，一个技术支持与工单诊断助手。
直接回答用户问题，使用清晰的 Markdown。收到知识库证据时，只能把它作为参考，不得编造引用。
不要执行命令、修改文件或请求额外工具。`;

export const chatScenario: ScenarioDefinition = {
  id: "chat",
  label: "普通问答",
  requiresKnowledgeBase: false,
  instructions: CHAT_INSTRUCTIONS,
  systemPrompt: CHAT_SYSTEM_PROMPT,
  retrieval: {
    queries: (input) => [input],
    task: (input) => `用户：${input}`,
  },
};
