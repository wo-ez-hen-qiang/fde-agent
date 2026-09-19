import { chatStore } from "@/lib/server";

export const runtime = "nodejs";

/** GET /api/sessions - list chat history. */
export async function GET() {
  const sessions = await chatStore().listSessions();
  return Response.json({ sessions });
}

/** POST /api/sessions - create a session explicitly. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    knowledgeBaseId?: string;
    model?: string;
  };
  const session = await chatStore().createSession(body);
  return Response.json({ session }, { status: 201 });
}
