"use client";

import type {
  AgentBackendId,
  AgentBackendStatus,
  AgentLogEvent,
  ChatMessage,
  ChatSession,
  ChatStreamEvent,
  KnowledgeBase,
  ModelDescriptor,
  ScenarioResult,
  StructuredScenarioId,
} from "@fde/shared";

/** Client-side API helpers. */

export async function fetchSessions(): Promise<ChatSession[]> {
  const res = await fetch("/api/sessions");
  const json = await res.json();
  return json.sessions ?? [];
}

export async function fetchSessionDetail(
  id: string,
): Promise<{ session: ChatSession; messages: ChatMessage[] }> {
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

export async function fetchBackends(): Promise<{
  backends: AgentBackendStatus[];
  defaultBackend: AgentBackendId;
}> {
  const res = await fetch("/api/backends");
  if (!res.ok) throw new Error("加载运行方式失败");
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
  body: {
    sessionId?: string;
    message: string;
    model?: string;
    knowledgeBaseId?: string;
    backend?: AgentBackendId;
  },
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

/** 运行一个结构化场景（工单诊断 / 售前方案）。 */
export async function scenarioRequest(
  body: {
    scenario: StructuredScenarioId;
    /** 工单内容或售前受理表/画布材料。 */
    input: string;
    sessionId?: string;
    model?: string;
    knowledgeBaseId: string;
    backend?: AgentBackendId;
    /** @deprecated 售前请用 presalesPhase。 */
    forceReport?: boolean;
    presalesPhase?: "canvas" | "report";
  },
  signal?: AbortSignal,
): Promise<{ result: ScenarioResult; sessionId: string; markdown: string; logs: AgentLogEvent[] }> {
  // 诊断保留它自己的端点（既有契约与测试都对着它），其余场景走通用端点
  const endpoint = body.scenario === "diagnosis" ? "/api/diagnose" : "/api/scenario";
  const payload =
    body.scenario === "diagnosis"
      ? {
          sessionId: body.sessionId,
          ticket: body.input,
          model: body.model,
          knowledgeBaseId: body.knowledgeBaseId,
          backend: body.backend,
        }
      : body;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  const json = (await res.json().catch(() => ({}))) as {
    result?: ScenarioResult;
    diagnosis?: ScenarioResult;
    sessionId?: string;
    markdown?: string;
    logs?: AgentLogEvent[];
    error?: string;
  };
  // 老的 /api/diagnose 契约没有判别字段，这里补上，前端才能按 scenario 分派。
  // 响应体是未校验的 JSON，所以按 Record 处理后再收窄成 ScenarioResult。
  const raw = (json.result ?? json.diagnosis) as Record<string, unknown> | undefined;
  const result = (
    raw && body.scenario === "diagnosis" && !raw.scenario ? { ...raw, scenario: "diagnosis" } : raw
  ) as ScenarioResult | undefined;
  if (!res.ok || !result || !json.sessionId) {
    throw new Error(json.error ?? `生成失败 (${res.status})`);
  }
  return {
    result,
    sessionId: json.sessionId,
    markdown: json.markdown ?? "",
    logs: json.logs ?? [],
  };
}
