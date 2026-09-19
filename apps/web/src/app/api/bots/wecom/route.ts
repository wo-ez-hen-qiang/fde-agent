import { botDispatcher } from "@/lib/server";
import type { BotWebhookRequest } from "@fde/bot-core";

export const runtime = "nodejs";

function queryOf(req: Request): Record<string, string | undefined> {
  const url = new URL(req.url);
  return Object.fromEntries(url.searchParams.entries());
}

/** GET /api/bots/wecom - callback URL verification. */
export async function GET(req: Request) {
  const webhookReq: BotWebhookRequest = {
    method: "GET",
    headers: Object.fromEntries(req.headers.entries()),
    body: undefined,
    query: queryOf(req),
  };
  const result = await botDispatcher().dispatch("wecom", webhookReq);
  if (result.kind === "challenge") {
    return new Response(String(result.response), {
      headers: { "content-type": result.contentType ?? "text/plain" },
    });
  }
  return Response.json({
    ok: false,
    kind: result.kind,
    reason: result.kind === "ignored" ? result.reason : undefined,
  });
}

/** POST /api/bots/wecom - encrypted message callback. */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const webhookReq: BotWebhookRequest = {
    method: "POST",
    headers: Object.fromEntries(req.headers.entries()),
    body: rawBody,
    rawBody,
    query: queryOf(req),
  };
  const result = await botDispatcher().dispatch("wecom", webhookReq);
  // WeCom needs a fast empty 200; the reply goes out via the send API
  return new Response(result.kind === "ignored" ? "success" : "success", { status: 200 });
}
