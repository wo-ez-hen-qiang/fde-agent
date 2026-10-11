import { randomUUID } from "node:crypto";
import type { ChatRequest, ChatStreamEvent } from "@fde/shared";
import { defaultAgentBackendId, resolveAgentBackend, runWithAgentLogs } from "@fde/agent-runtime";
import { chatStore } from "@/lib/server";

export const runtime = "nodejs";

/** POST /api/chat - SSE streaming chat. */
export async function POST(req: Request) {
  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json body" }, { status: 400 });
  }
  if (!body.message?.trim()) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }

  const store = chatStore();
  const existingSession = body.sessionId ? await store.getSession(body.sessionId) : null;
  if (body.sessionId && !existingSession) {
    return Response.json({ error: "session not found" }, { status: 404 });
  }
  if (existingSession && body.backend && body.backend !== existingSession.backend) {
    return Response.json({ error: "已有会话不能切换运行后端，请新建会话" }, { status: 409 });
  }
  const backendId = existingSession?.backend ?? body.backend ?? defaultAgentBackendId();
  let backend;
  try {
    backend = resolveAgentBackend(backendId);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
  const backendStatus = await backend.inspect();
  if (!backendStatus.available) {
    return Response.json({ error: backendStatus.detail }, { status: 503 });
  }
  const sessionId =
    body.sessionId ??
    (
      await store.createSession({
        channel: body.channel ?? "web",
        knowledgeBaseId: body.knowledgeBaseId,
        model: body.model,
        backend: backendId,
      })
    ).id;

  await store.appendMessage({ sessionId, role: "user", content: body.message });
  await store.maybeAutoTitle(sessionId, body.message);

  const history = (await store.listMessages(sessionId))
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
    .slice(0, -1);

  const messageId = randomUUID();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      let fullText = "";
      let actualModel = body.model;
      try {
        await runWithAgentLogs(
          async () => {
            for await (const event of backend.streamChat({
              sessionId,
              providerSessionId: existingSession?.providerSessionId,
              input: body.message,
              history,
              model: body.model,
              knowledgeBaseId: body.knowledgeBaseId,
              signal: req.signal,
            })) {
              if (event.type === "backend_session") {
                await store.setProviderSession(sessionId, event.sessionId);
                actualModel = event.model ?? actualModel;
                continue;
              }
              if (event.type === "delta") fullText += event.text;
              if (event.type === "done") event.messageId = messageId;
              send(event);
            }
          },
          (logEvent) => {
            send({
              type: "log",
              tag: logEvent.tag,
              level: logEvent.level,
              message: logEvent.message,
            });
          },
        );
        if (fullText) {
          await store.appendMessage({
            id: messageId,
            sessionId,
            role: "assistant",
            content: fullText,
            model: actualModel,
            knowledgeBaseId: body.knowledgeBaseId,
          });
        }
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-session-id": sessionId,
    },
  });
}
