/**
 * CLI 后端（claude / codex / cursor）的前置检索与提示词拼装。
 * 提示词、检索 query、任务段全部来自场景注册表 —— 后端只负责搬运。
 */
import { KnowledgeStore, embeddingClientFromEnv } from "@fde/data";
import type {
  AgentHistoryItem,
  AgentRunRequest,
  DiagnosisReference,
  DiagnosisResult,
  KnowledgeSearchHit,
  ScenarioId,
} from "@fde/shared";
import { diagnosisScenario, getScenario } from "../scenarios/index.js";
import { agentLog } from "../log.js";

let knowledgeStoreInstance: KnowledgeStore | undefined;

function knowledgeStore(): KnowledgeStore {
  return (knowledgeStoreInstance ??= new KnowledgeStore(embeddingClientFromEnv()));
}

/** 检索条数：库大时可调（默认 5，保持既有行为）。 */
function knowledgeTopK(): number {
  const configured = Number(process.env.FDE_KB_TOP_K?.trim() || "");
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 5;
}

function renderHistory(history: AgentHistoryItem[] | undefined): string {
  if (!history?.length) return "";
  return history
    .slice(-20)
    .map((item) => `${item.role === "user" ? "用户" : "助手"}: ${item.content}`)
    .join("\n");
}

export interface PreparedPrompt {
  prompt: string;
  references: DiagnosisReference[];
}

export async function preparePrompt(
  request: AgentRunRequest,
  scenario: ScenarioId,
): Promise<PreparedPrompt> {
  const definition = getScenario(scenario);
  const references: DiagnosisReference[] = [];
  const evidence: string[] = [];

  if (request.knowledgeBaseId) {
    const knowledgeBaseId = request.knowledgeBaseId;
    const perQuery = knowledgeTopK();
    agentLog("kb:search", `开始检索 scenario=${scenario} topK=${perQuery}`);
    // 多 query 合并去重：长输入（如售前的客户画像+场景）单 query 检索质量差
    const merged = new Map<string, KnowledgeSearchHit>();
    for (const query of definition.retrieval.queries(request.input)) {
      for (const hit of await knowledgeStore().search(knowledgeBaseId, query, perQuery)) {
        if (!merged.has(hit.chunk.id)) merged.set(hit.chunk.id, hit);
      }
    }
    const hits = [...merged.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(8, perQuery * 2));

    agentLog(
      "kb:search",
      `命中 ${hits.length} 条` +
        (hits[0] ? `，最高分 ${hits[0].score.toFixed(2)}（${hits[0].documentTitle}）` : ""),
    );

    hits.forEach((hit, index) => {
      references.push({
        knowledgeBaseId,
        documentId: hit.chunk.documentId,
        documentTitle: hit.documentTitle,
        chunkId: hit.chunk.id,
        excerpt: hit.chunk.content.slice(0, 300),
        score: hit.score,
      });
      evidence.push(
        `[证据 ${index + 1}] 文档：${hit.documentTitle}\n${hit.chunk.content.slice(0, 1800)}`,
      );
    });
  }

  const history = request.providerSessionId ? "" : renderHistory(request.history);
  const parts = [
    history ? `历史对话：\n${history}` : "",
    evidence.length > 0
      ? `知识库证据：\n${evidence.join("\n\n")}`
      : request.knowledgeBaseId
        ? "知识库没有检索到相关依据。请明确说明证据不足。"
        : "",
    definition.retrieval.task(request.input, {
      forceReport: request.forceReport,
      presalesPhase: request.presalesPhase,
    }),
  ];

  return { prompt: parts.filter(Boolean).join("\n\n"), references };
}

/** @deprecated 用 getScenario("diagnosis").parse；保留以兼容既有调用。 */
export function parseDiagnosis(value: unknown, references: DiagnosisReference[]): DiagnosisResult {
  return diagnosisScenario.parse!(value, references) as DiagnosisResult;
}
