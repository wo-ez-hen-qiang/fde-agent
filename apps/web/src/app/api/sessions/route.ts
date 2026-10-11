import { chatStore } from "@/lib/server";
import type { AgentBackendId, ChatSession } from "@fde/shared";

export const runtime = "nodejs";

/** GET /api/sessions - list chat history. */
export async function GET() {
  const sessions = await chatStore().listSessions();
  return Response.json({ sessions: sessions.map(publicSession) });
}

/** POST /api/sessions - create a session explicitly. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    knowledgeBaseId?: string;
    model?: string;
    backend?: AgentBackendId;
  };
  const session = await chatStore().createSession(body);
  return Response.json({ session: publicSession(session) }, { status: 201 });
}

function publicSession(session: ChatSession): Omit<ChatSession, "providerSessionId"> {
  const { providerSessionId: _private, ...safe } = session;
  return safe;
}
