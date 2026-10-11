import {
  isStructuredScenarioId,
  type AgentBackendId,
  type StructuredScenarioId,
} from "@fde/shared";
import { runScenarioRoute } from "@/lib/scenario-route";

export const runtime = "nodejs";

interface ScenarioBody {
  scenario: StructuredScenarioId;
  input: string;
  knowledgeBaseId?: string;
  model?: string;
  sessionId?: string;
  backend?: AgentBackendId;
  forceReport?: boolean;
  presalesPhase?: "canvas" | "report";
}

/** POST /api/scenario - 运行一个结构化场景（工单诊断 / 售前方案）。 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as ScenarioBody;
  console.log(
    `[PRESALES-DEMO] step 1: POST /api/scenario received scenario=${String(body.scenario)} phase=${String(body.presalesPhase ?? "")} kb=${String(body.knowledgeBaseId ?? "")} inputLen=${String(body.input?.length ?? 0)} backend=${String(body.backend ?? "")}`,
  );
  if (!isStructuredScenarioId(body.scenario)) {
    return Response.json({ error: `未知场景：${String(body.scenario)}` }, { status: 400 });
  }

  const outcome = await runScenarioRoute({
    scenario: body.scenario,
    input: body.input,
    sessionId: body.sessionId,
    knowledgeBaseId: body.knowledgeBaseId,
    model: body.model,
    backend: body.backend,
    forceReport: body.forceReport === true,
    presalesPhase: body.presalesPhase,
    signal: req.signal,
  });

  if (outcome.ok) {
    console.log(
      `[PRESALES-DEMO] step 14: /api/scenario response ok sessionId=${outcome.sessionId} stage=${"stage" in outcome.result ? String((outcome.result as { stage?: string }).stage ?? "") : ""} markdownLen=${outcome.markdown.length}`,
    );
    return Response.json({
      result: outcome.result,
      scenario: outcome.scenario,
      sessionId: outcome.sessionId,
      markdown: outcome.markdown,
      logs: outcome.logs,
    });
  }
  console.log(
    `[PRESALES-DEMO] step 14: /api/scenario response FAIL status=${outcome.status} error=${outcome.error}`,
  );
  return Response.json({ error: outcome.error, logs: outcome.logs }, { status: outcome.status });
}
