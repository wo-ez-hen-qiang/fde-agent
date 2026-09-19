import { knowledgeStore } from "@/lib/server";

export const runtime = "nodejs";

/** GET /api/knowledge - list knowledge bases. */
export async function GET() {
  try {
    const kbs = await knowledgeStore().listKnowledgeBases();
    return Response.json({ knowledgeBases: kbs });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/** POST /api/knowledge - create a knowledge base. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { name?: string; description?: string };
  if (!body.name?.trim()) return Response.json({ error: "name is required" }, { status: 400 });
  try {
    const kb = await knowledgeStore().createKnowledgeBase(body.name.trim(), body.description);
    return Response.json({ knowledgeBase: kb }, { status: 201 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
