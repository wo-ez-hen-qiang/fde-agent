import { chatStore } from "@/lib/server";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string }>;
}

/** GET /api/sessions/[id] - session detail with messages. */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const store = chatStore();
  const session = await store.getSession(id);
  if (!session) return Response.json({ error: "session not found" }, { status: 404 });
  const messages = await store.listMessages(id);
  return Response.json({ session, messages });
}

/** DELETE /api/sessions/[id] */
export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  await chatStore().deleteSession(id);
  return Response.json({ ok: true });
}

/** PATCH /api/sessions/[id] - rename. */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = (await req.json()) as { title?: string };
  if (!body.title?.trim()) return Response.json({ error: "title required" }, { status: 400 });
  await chatStore().renameSession(id, body.title.trim());
  return Response.json({ ok: true });
}
