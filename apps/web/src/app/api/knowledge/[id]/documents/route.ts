import { knowledgeStore } from "@/lib/server";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string }>;
}

/** POST /api/knowledge/[id]/documents - ingest a text document (split + embed + store). */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { title?: string; text?: string };
  if (!body.title?.trim() || !body.text?.trim()) {
    return Response.json({ error: "title and text are required" }, { status: 400 });
  }
  try {
    const doc = await knowledgeStore().addDocument(id, body.title.trim(), body.text);
    return Response.json({ document: doc }, { status: 201 });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
