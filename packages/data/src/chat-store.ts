import { randomUUID } from "node:crypto";
import type { Channel, ChatMessage, ChatSession } from "@fde/shared";
import { getDb } from "./db.js";

/** Chat history persistence (sessions + messages). */
export class ChatStore {
  async createSession(input: {
    title?: string;
    channel?: Channel;
    knowledgeBaseId?: string;
    model?: string;
  }): Promise<ChatSession> {
    const db = await getDb();
    const id = randomUUID();
    const now = Date.now();
    await db.query(
      `INSERT INTO chat_sessions (id, title, channel, knowledge_base_id, model, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        input.title ?? "新对话",
        input.channel ?? "web",
        input.knowledgeBaseId ?? null,
        input.model ?? null,
        now,
        now,
      ],
    );
    return {
      id,
      title: input.title ?? "新对话",
      channel: input.channel ?? "web",
      knowledgeBaseId: input.knowledgeBaseId,
      model: input.model,
      createdAt: now,
      updatedAt: now,
    };
  }

  async listSessions(limit = 50): Promise<ChatSession[]> {
    const db = await getDb();
    const res = await db.query<{
      id: string;
      title: string;
      channel: Channel;
      knowledge_base_id: string | null;
      model: string | null;
      created_at: number;
      updated_at: number;
    }>(`SELECT * FROM chat_sessions ORDER BY updated_at DESC LIMIT $1`, [limit]);
    return res.rows.map(mapSession);
  }

  async getSession(id: string): Promise<ChatSession | null> {
    const db = await getDb();
    const res = await db.query<Parameters<typeof mapSession>[0]>(
      `SELECT * FROM chat_sessions WHERE id = $1`,
      [id],
    );
    const row = res.rows[0];
    return row ? mapSession(row) : null;
  }

  async renameSession(id: string, title: string): Promise<void> {
    const db = await getDb();
    await db.query(`UPDATE chat_sessions SET title = $1, updated_at = $2 WHERE id = $3`, [
      title,
      Date.now(),
      id,
    ]);
  }

  async deleteSession(id: string): Promise<void> {
    const db = await getDb();
    await db.query(`DELETE FROM chat_sessions WHERE id = $1`, [id]);
  }

  async appendMessage(
    msg: Omit<ChatMessage, "id" | "createdAt"> & { id?: string },
  ): Promise<ChatMessage> {
    const db = await getDb();
    const id = msg.id ?? randomUUID();
    const now = Date.now();
    await db.query(
      `INSERT INTO chat_messages (id, session_id, role, content, model, knowledge_base_id, usage, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        msg.sessionId,
        msg.role,
        msg.content,
        msg.model ?? null,
        msg.knowledgeBaseId ?? null,
        msg.usage ? JSON.stringify(msg.usage) : null,
        now,
      ],
    );
    await db.query(`UPDATE chat_sessions SET updated_at = $1 WHERE id = $2`, [now, msg.sessionId]);
    return { ...msg, id, createdAt: now };
  }

  async listMessages(sessionId: string): Promise<ChatMessage[]> {
    const db = await getDb();
    const res = await db.query<{
      id: string;
      session_id: string;
      role: ChatMessage["role"];
      content: string;
      model: string | null;
      knowledge_base_id: string | null;
      usage: ChatMessage["usage"] | null;
      created_at: number;
    }>(`SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC`, [sessionId]);
    return res.rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      role: r.role,
      content: r.content,
      model: r.model ?? undefined,
      knowledgeBaseId: r.knowledge_base_id ?? undefined,
      usage: r.usage ?? undefined,
      createdAt: Number(r.created_at),
    }));
  }

  /** Auto-title a session from its first user message. */
  async maybeAutoTitle(sessionId: string, firstMessage: string): Promise<void> {
    const db = await getDb();
    const res = await db.query<{ title: string }>(`SELECT title FROM chat_sessions WHERE id = $1`, [
      sessionId,
    ]);
    if (res.rows[0]?.title === "新对话") {
      const title = firstMessage.slice(0, 24) + (firstMessage.length > 24 ? "…" : "");
      await this.renameSession(sessionId, title);
    }
  }
}

function mapSession(r: {
  id: string;
  title: string;
  channel: Channel;
  knowledge_base_id: string | null;
  model: string | null;
  created_at: number;
  updated_at: number;
}): ChatSession {
  return {
    id: r.id,
    title: r.title,
    channel: r.channel,
    knowledgeBaseId: r.knowledge_base_id ?? undefined,
    model: r.model ?? undefined,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}
