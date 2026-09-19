import { randomUUID } from "node:crypto";
import type { ChatRequest, ChatStreamEvent } from "@fde/shared";
import { buildChatAgent, streamChat } from "@fde/agent-runtime";
import { chatStore, mcpManager } from "@/lib/server";

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
  const sessionId =
    body.sessionId ??
    (await store.createSession({
      channel: body.channel ?? "web",
      knowledgeBaseId: body.knowledgeBaseId,
      model: body.model,
    })).id;

  await store.appendMessage({ sessionId, role: "user", content: body.message });
  await store.maybeAutoTitle(sessionId, body.message);

  const history = (await store.listMessages(sessionId))
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const messageId = randomUUID();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      let fullText = "";
      try {
        const agent = await buildChatAgent({
          modelAlias: body.model,
          knowledgeBaseId: body.knowledgeBaseId,
          mcpManager: mcpManager(),
        });
        for await (const event of streamChat({ agent, input: body.message, history })) {
          if (event.type === "delta") fullText += event.text;
          if (event.type === "done") event.messageId = messageId;
          send(event);
        }
        if (fullText) {
          await store.appendMessage({
            id: messageId,
            sessionId,
            role: "assistant",
            content: fullText,
            model: body.model,
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
