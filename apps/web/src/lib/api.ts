"use client";

import type { ChatMessage, ChatSession, ChatStreamEvent, KnowledgeBase, ModelDescriptor } from "@fde/shared";

/** Client-side API helpers. */

export async function fetchSessions(): Promise<ChatSession[]> {
  const res = await fetch("/api/sessions");
  const json = await res.json();
  return json.sessions ?? [];
}

export async function fetchSessionDetail(id: string): Promise<{ session: ChatSession; messages: ChatMessage[] }> {
  const res = await fetch(`/api/sessions/${id}`);
  if (!res.ok) throw new Error("加载会话失败");
  return res.json();
}

export async function deleteSession(id: string): Promise<void> {
  await fetch(`/api/sessions/${id}`, { method: "DELETE" });
}

export async function fetchModels(): Promise<{ models: ModelDescriptor[]; defaultModel: string }> {
  const res = await fetch("/api/models");
  return res.json();
}

export async function fetchKnowledgeBases(): Promise<KnowledgeBase[]> {
  const res = await fetch("/api/knowledge");
  const json = await res.json().catch(() => ({}));
  return json.knowledgeBases ?? [];
}

export interface StreamCallbacks {
  onEvent: (event: ChatStreamEvent) => void;
  onSessionId: (id: string) => void;
  signal?: AbortSignal;
}

/** POST /api/chat and consume the SSE stream. */
export async function streamChatRequest(
  body: { sessionId?: string; message: string; model?: string; knowledgeBaseId?: string },
  cb: StreamCallbacks,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: cb.signal ?? null,
  });
  const sessionId = res.headers.get("x-session-id");
  if (sessionId) cb.onSessionId(sessionId);
  if (!res.ok || !res.body) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? `请求失败 (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        cb.onEvent(JSON.parse(line.slice(6)) as ChatStreamEvent);
      } catch {
        // ignore malformed keep-alive lines
      }
    }
  }
}
