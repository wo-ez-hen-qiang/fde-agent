import { tool } from "@openai/agents";
import { z } from "zod";
import { KnowledgeStore, embeddingClientFromEnv } from "@fde/data";
import { agentLog } from "./log.js";

let store: KnowledgeStore | null = null;

function getStore(): KnowledgeStore {
  if (!store) {
    store = new KnowledgeStore(embeddingClientFromEnv());
  }
  return store;
}

/**
 * Native tool: knowledge base retrieval. This is the R in RAG -
 * the agent decides when to search and with what query.
 */
export const knowledgeSearchTool = tool({
  name: "search_knowledge_base",
  description:
    "在知识库中检索与问题相关的历史工单、故障处理文档和解决方案。当需要参考历史经验时调用。",
  parameters: z.object({
    knowledgeBaseId: z.string().describe("知识库 ID"),
    query: z.string().describe("检索查询，应包含问题的核心症状和关键词"),
    topK: z.number().int().min(1).max(10).default(5).describe("返回条数"),
  }),
  execute: async ({ knowledgeBaseId, query, topK }) => {
    console.log(
      `[PRESALES-DEMO] step 10: tool search_knowledge_base kb=${knowledgeBaseId} topK=${topK} query=${query.slice(0, 120)}`,
    );
    agentLog("kb:search", `tool 检索 topK=${topK} queryLen=${query.length}`);
    const hits = await getStore().search(knowledgeBaseId, query, topK);
    console.log(
      `[PRESALES-DEMO] step 10b: tool search_knowledge_base hits=${hits.length}` +
        (hits[0] ? ` topScore=${hits[0].score.toFixed(4)} doc=${hits[0].documentTitle}` : ""),
    );
    agentLog(
      "kb:search",
      `tool 命中 ${hits.length} 条` +
        (hits[0] ? `，最高分 ${hits[0].score.toFixed(2)}（${hits[0].documentTitle}）` : ""),
    );
    return hits.map((h) => ({
      document: h.documentTitle,
      excerpt: h.chunk.content,
      score: Number(h.score.toFixed(4)),
      chunkId: h.chunk.id,
      documentId: h.chunk.documentId,
    }));
  },
});

export const nativeTools = [knowledgeSearchTool];
