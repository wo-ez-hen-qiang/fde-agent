import type { DiagnosisResult } from "@fde/shared";
import { buildDiagnosisAgent, runDiagnosis } from "@fde/agent-runtime";
import { chatStore, mcpManager } from "@/lib/server";

export const runtime = "nodejs";

interface DiagnoseBody {
  ticket: string;
  knowledgeBaseId?: string;
  model?: string;
  sessionId?: string;
}

/** POST /api/diagnose - structured ticket diagnosis with citations. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as DiagnoseBody;
  if (!body.ticket?.trim()) {
    return Response.json({ error: "ticket is required" }, { status: 400 });
  }
  if (!body.knowledgeBaseId) {
    return Response.json({ error: "knowledgeBaseId is required for diagnosis" }, { status: 400 });
  }

  try {
    const agent = await buildDiagnosisAgent({
      modelAlias: body.model,
      knowledgeBaseId: body.knowledgeBaseId,
      mcpManager: mcpManager(),
    });
    const { output, references } = await runDiagnosis({
      agent,
      input: body.ticket,
      knowledgeBaseId: body.knowledgeBaseId,
    });

    const result: DiagnosisResult = {
      summary: output.summary,
      location: output.location,
      rootCause: output.rootCause,
      solution: output.solution,
      prevention: output.prevention,
      confidence: output.confidence,
      references,
      createdAt: Date.now(),
    };

    // persist into the session as a markdown message so history shows it
    if (body.sessionId) {
      const md = [
        `**诊断结论**：${output.summary}`,
        `**问题定位**：${output.location}`,
        `**根因分析**：${output.rootCause}`,
        `**解决方案**：${output.solution}`,
        `**预防措施**：${output.prevention}`,
      ].join("\n\n");
      await chatStore().appendMessage({
        sessionId: body.sessionId,
        role: "assistant",
        content: md,
        model: body.model,
        knowledgeBaseId: body.knowledgeBaseId,
      });
    }

    return Response.json({ diagnosis: result });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
