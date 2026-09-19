import { botDispatcher } from "@/lib/server";
import type { BotWebhookRequest } from "@fde/bot-core";

export const runtime = "nodejs";

/** POST /api/bots/feishu - Feishu event callback. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => undefined);
  const webhookReq: BotWebhookRequest = {
    method: "POST",
    headers: Object.fromEntries(req.headers.entries()),
    body,
  };
  const result = await botDispatcher().dispatch("feishu", webhookReq);
  if (result.kind === "challenge") {
    return Response.json(result.response);
  }
  // Feishu expects a fast 200 regardless
  return Response.json({ ok: true, kind: result.kind });
}
