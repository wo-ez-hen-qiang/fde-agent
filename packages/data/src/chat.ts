import { randomUUID } from "node:crypto";
import type {
  AgentBackendId,
  Channel,
  ChatMessage,
  ChatRole,
  ChatSession,
  ChatUsage,
  DiagnosisResult,
  ScenarioId,
  ScenarioResult,
} from "@fde/shared";
import { getDb } from "./db.js";

/** Chat history persistence: sessions + messages. */

const DEFAULT_TITLE = "新对话";
const TITLE_MAX = 24;

interface SessionRow {
  id: string;
  title: string;
  channel: string;
  knowledge_base_id: string | null;
  model: string | null;
  backend: string;
  provider_session_id: string | null;
  scenario: string | null;
  created_at: number | string;
  updated_at: number | string;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  model: string | null;
  knowledge_base_id: string | null;
  usage: unknown;
  diagnosis: unknown;
  scenario: string | null;
  scenario_result: unknown;
  created_at: number | string;
}

function toSession(row: SessionRow): ChatSession {
  return {
    id: row.id,
    title: row.title,
    channel: row.channel as Channel,
    knowledgeBaseId: row.knowledge_base_id ?? undefined,
    model: row.model ?? undefined,
    backend: (row.backend || "api") as AgentBackendId,
    scenario: (row.scenario as ScenarioId | null) ?? "chat",
    providerSessionId: row.provider_session_id ?? undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function toMessage(row: MessageRow): ChatMessage {
  // 旧行只有 diagnosis 列：回退映射成统一的 scenarioResult 形状，
  // 这样前端（按 scenarioResult.scenario 分派）对旧会话照常渲染。
  const legacy = (row.diagnosis as DiagnosisResult | null) ?? null;
  const scenarioResult =
    (row.scenario_result as ScenarioResult | null) ??
    (legacy ? { ...legacy, scenario: "diagnosis" as const } : null);
  const scenario =
    (row.scenario as ScenarioId | null) ??
    (scenarioResult?.scenario as ScenarioId | undefined) ??
    null;

  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as ChatRole,
    content: row.content,
    model: row.model ?? undefined,
    knowledgeBaseId: row.knowledge_base_id ?? undefined,
    usage: (row.usage as ChatUsage | null) ?? undefined,
    scenario: scenario ?? undefined,
    scenarioResult: scenarioResult ?? undefined,
    diagnosis: scenarioResult?.scenario === "diagnosis" ? scenarioResult : undefined,
    createdAt: Number(row.created_at),
  };
}

export interface CreateSessionInput {
  title?: string;
  channel?: Channel | string;
  knowledgeBaseId?: string;
  model?: string;
  backend?: AgentBackendId;
  scenario?: ScenarioId;
  providerSessionId?: string;
}

export interface AppendMessageInput {
  id?: string;
  sessionId: string;
  role: ChatRole;
  content: string;
  model?: string;
  knowledgeBaseId?: string;
  usage?: ChatUsage;
  scenario?: ScenarioId;
  scenarioResult?: ScenarioResult;
  /** @deprecated 请用 scenarioResult；传入时自动落成 { scenario: "diagnosis" } 形状。 */
  diagnosis?: DiagnosisResult;
}

export class ChatStore {
  /** Create a session; title falls back to a placeholder until auto-titled. */
  async createSession(input: CreateSessionInput = {}): Promise<ChatSession> {
    console.log(
      `[PRESALES-DEMO] ChatStore.createSession channel=${input.channel ?? "web"} scenario=${input.scenario ?? "chat"} kb=${input.knowledgeBaseId ?? ""}`,
    );
    const db = await getDb();
    const now = Date.now();
    const row: SessionRow = {
      id: randomUUID(),
      title: input.title?.trim() || DEFAULT_TITLE,
      channel: input.channel ?? "web",
      knowledge_base_id: input.knowledgeBaseId ?? null,
      model: input.model ?? null,
      backend: input.backend ?? "api",
      provider_session_id: input.providerSessionId ?? null,
      scenario: input.scenario ?? "chat",
      created_at: now,
      updated_at: now,
    };

    await db.query(
      `INSERT INTO chat_sessions
         (id, title, channel, knowledge_base_id, model, backend, provider_session_id, scenario, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        row.id,
        row.title,
        row.channel,
        row.knowledge_base_id,
        row.model,
        row.backend,
        row.provider_session_id,
        row.scenario,
        now,
        now,
      ],
    );

    return toSession(row);
  }

  async getSession(id: string): Promise<ChatSession | null> {
    const db = await getDb();
    const res = await db.query<SessionRow>(`SELECT * FROM chat_sessions WHERE id = $1`, [id]);
    const row = res.rows[0];
    return row ? toSession(row) : null;
  }

  async listSessions(): Promise<ChatSession[]> {
    const db = await getDb();
    const res = await db.query<SessionRow>(`SELECT * FROM chat_sessions ORDER BY updated_at DESC`);
    return res.rows.map(toSession);
  }

  async renameSession(id: string, title: string): Promise<void> {
    const db = await getDb();
    await db.query(`UPDATE chat_sessions SET title = $2, updated_at = $3 WHERE id = $1`, [
      id,
      title,
      Date.now(),
    ]);
  }

  async setProviderSession(id: string, providerSessionId: string): Promise<void> {
    const db = await getDb();
    await db.query(
      `UPDATE chat_sessions SET provider_session_id = $2, updated_at = $3 WHERE id = $1`,
      [id, providerSessionId, Date.now()],
    );
  }

  async deleteSession(id: string): Promise<void> {
    const db = await getDb();
    // Messages cascade.
    await db.query(`DELETE FROM chat_sessions WHERE id = $1`, [id]);
  }

  async listMessages(sessionId: string): Promise<ChatMessage[]> {
    const db = await getDb();
    const res = await db.query<MessageRow>(
      `SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC`,
      [sessionId],
    );
    console.log(
      `[PRESALES-DEMO] ChatStore.listMessages sessionId=${sessionId} count=${res.rows.length}`,
    );
    return res.rows.map(toMessage);
  }

  /** Append a message and bump the session's updated_at. */
  async appendMessage(input: AppendMessageInput): Promise<ChatMessage> {
    console.log(
      `[PRESALES-DEMO] ChatStore.appendMessage role=${input.role} sessionId=${input.sessionId} contentLen=${input.content.length} scenario=${input.scenario ?? ""}`,
    );
    const db = await getDb();
    const now = Date.now();
    const id = input.id ?? randomUUID();

    // 统一落到 scenario/scenario_result；diagnosis 是旧调用方的写法，这里补齐判别字段
    const scenarioResult: ScenarioResult | undefined =
      input.scenarioResult ??
      (input.diagnosis ? { ...input.diagnosis, scenario: "diagnosis" } : undefined);
    const scenario: ScenarioId | null = input.scenario ?? scenarioResult?.scenario ?? null;

    await db.query(
      `INSERT INTO chat_messages
         (id, session_id, role, content, model, knowledge_base_id, usage, scenario, scenario_result, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10)`,
      [
        id,
        input.sessionId,
        input.role,
        input.content,
        input.model ?? null,
        input.knowledgeBaseId ?? null,
        input.usage ? JSON.stringify(input.usage) : null,
        scenario,
        scenarioResult ? JSON.stringify(scenarioResult) : null,
        now,
      ],
    );
    await db.query(`UPDATE chat_sessions SET updated_at = $2 WHERE id = $1`, [
      input.sessionId,
      now,
    ]);

    return {
      id,
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      model: input.model,
      knowledgeBaseId: input.knowledgeBaseId,
      usage: input.usage,
      scenario: scenario ?? undefined,
      scenarioResult,
      diagnosis: scenarioResult?.scenario === "diagnosis" ? scenarioResult : undefined,
      createdAt: now,
    };
  }

  /** Title the session from the first user message, once. */
  async maybeAutoTitle(sessionId: string, firstMessage: string): Promise<void> {
    const db = await getDb();
    const res = await db.query<{ title: string }>(`SELECT title FROM chat_sessions WHERE id = $1`, [
      sessionId,
    ]);
    const current = res.rows[0]?.title;
    if (!current || current === DEFAULT_TITLE) {
      const text = firstMessage.replace(/\s+/g, " ").trim();
      if (!text) return;
      const title = text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX)}…` : text;
      await db.query(`UPDATE chat_sessions SET title = $2, updated_at = $3 WHERE id = $1`, [
        sessionId,
        title,
        Date.now(),
      ]);
    }
  }
}
