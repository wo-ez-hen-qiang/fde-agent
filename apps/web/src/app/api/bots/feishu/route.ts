import { after } from "next/server";
import { feishuConfigFromEnv } from "@fde/bot-core";
import type { BotWebhookRequest } from "@fde/bot-core";
import { botDispatcher } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notConfigured(): Response {
  const cfg = feishuConfigFromEnv(process.env);
  const missing = cfg.ok ? [] : cfg.missing;
  return Response.json(
    { error: `feishu bot is not configured; missing env: ${missing.join(", ")}` },
    { status: 503 },
  );
}

/** GET /api/bots/feishu - config status probe (no secrets). */
export async function GET() {
  const cfg = feishuConfigFromEnv(process.env);
  return Response.json({
    platform: "feishu",
    configured: cfg.ok,
    missing: cfg.ok ? [] : cfg.missing,
    encrypted: cfg.ok ? Boolean(cfg.options.encryptKey) : false,
  });
}

/** POST /api/bots/feishu - Feishu event subscription callback. */
export async function POST(req: Request) {
  const dispatcher = botDispatcher();
  if (!dispatcher.has("feishu")) return notConfigured();

  const rawBody = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "invalid json body" }, { status: 400 });
  }
  const webhookReq: BotWebhookRequest = {
    method: "POST",
    headers: Object.fromEntries(req.headers.entries()),
    body,
    rawBody,
  };
  // ack within Feishu's 3s window; the agent run + reply happen after the response
  const result = await dispatcher.dispatch("feishu", webhookReq, {
    schedule: (task) => after(task),
  });
  switch (result.kind) {
    case "challenge":
      return Response.json(result.response);
    case "rejected":
      console.warn(`[web] feishu callback rejected: ${result.reason}`);
      return Response.json({ error: result.reason }, { status: result.status });
    default:
      return Response.json({ ok: true, kind: result.kind });
  }
}
