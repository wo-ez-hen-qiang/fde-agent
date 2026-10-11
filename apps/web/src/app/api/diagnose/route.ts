import type { AgentBackendId } from "@fde/shared";
import { runScenarioRoute } from "@/lib/scenario-route";

export const runtime = "nodejs";

interface DiagnoseBody {
  ticket: string;
  knowledgeBaseId?: string;
  model?: string;
  sessionId?: string;
  backend?: AgentBackendId;
}

/**
 * POST /api/diagnose - 结构化工单诊断（带引用）。
 * 实现已泛化到 /api/scenario；这里保留原路由与响应体，既有调用方与 e2e 不受影响。
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as DiagnoseBody;
  if (!body.ticket?.trim()) {
    return Response.json({ error: "ticket is required" }, { status: 400 });
  }

  const outcome = await runScenarioRoute({
    scenario: "diagnosis",
    input: body.ticket,
    sessionId: body.sessionId,
    knowledgeBaseId: body.knowledgeBaseId,
    model: body.model,
    backend: body.backend,
    signal: req.signal,
  });

  return outcome.ok
    ? Response.json({
        diagnosis: outcome.result,
        sessionId: outcome.sessionId,
        logs: outcome.logs,
      })
    : Response.json({ error: outcome.error, logs: outcome.logs }, { status: outcome.status });
}
