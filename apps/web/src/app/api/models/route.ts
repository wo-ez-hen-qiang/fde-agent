import { listModels, defaultModelAlias } from "@fde/model-gateway";

export const runtime = "nodejs";

/** GET /api/models - model catalog with enablement flags (drives the selector). */
export async function GET() {
  return Response.json({ models: listModels(), defaultModel: defaultModelAlias() });
}
