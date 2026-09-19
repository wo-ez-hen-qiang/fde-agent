import { tool } from "@openai/agents";
import { z } from "zod";
import { KnowledgeStore, embeddingClientFromEnv } from "@fde/data";

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
    const hits = await getStore().search(knowledgeBaseId, query, topK);
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
