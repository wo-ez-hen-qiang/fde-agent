import { defaultAgentBackendId, inspectAgentBackends } from "@fde/agent-runtime";

export const runtime = "nodejs";

export async function GET() {
  try {
    const backends = await inspectAgentBackends();
    return Response.json({ backends, defaultBackend: defaultAgentBackendId() });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
