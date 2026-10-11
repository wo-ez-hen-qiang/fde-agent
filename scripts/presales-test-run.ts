/**
 * 对 10 条假设客户跑一轮售前画布，结果写入前端可导入的 JSON。
 * 用法：先启动 web，再 `pnpm --filter @fde/cli exec tsx ../../scripts/presales-test-run.ts`
 */
import { writeFileSync } from "node:fs";
import { PRESALES_CANVAS_FIELDS, PRESALES_TEST_CASES, serializePresalesIntake } from "@fde/shared";

const KB = "878d99bc-d97b-4f3b-90f5-d956ade564d8";
const OUT = new URL("../apps/web/src/data/presales-test-runs.ts", import.meta.url);

interface RunRow {
  id: string;
  title: string;
  ok: boolean;
  httpStatus: number;
  elapsedMs: number;
  stage: string | null;
  summary: string | null;
  adpMode: string | null;
  missingFields: string[];
  error: string | null;
  logTags: string[];
}

const rows: RunRow[] = [];

function save(done: boolean) {
  const payload = {
    ranAt: new Date().toISOString(),
    backend: "api",
    knowledgeBaseId: KB,
    phase: "canvas",
    done,
    cases: rows,
  };
  writeFileSync(
    OUT,
    `/** 由 scripts/presales-test-run.ts 生成，售前对话区直接展示。 */\nexport const presalesTestRun = ${JSON.stringify(payload, null, 2)} as const;\n`,
  );
}

async function main() {
  for (const testCase of PRESALES_TEST_CASES) {
    const started = Date.now();
    const res = await fetch("http://127.0.0.1:3000/api/scenario", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scenario: "presales",
        presalesPhase: "canvas",
        backend: "api",
        knowledgeBaseId: KB,
        input: serializePresalesIntake(testCase.intake),
      }),
    });
    const text = await res.text();
    let json: {
      error?: string;
      result?: Record<string, unknown>;
      logs?: Array<{ tag: string }>;
    };
    try {
      json = JSON.parse(text) as typeof json;
    } catch {
      json = { error: text.replace(/<[^>]+>/g, " ").slice(0, 240) };
    }
    const result = json.result ?? {};
    const missingFields = PRESALES_CANVAS_FIELDS.filter(([key]) => {
      const value = result[key];
      return typeof value !== "string" || value.trim().length === 0;
    }).map(([, label]) => label);
    const stage = typeof result.stage === "string" ? result.stage : null;
    const row: RunRow = {
      id: testCase.id,
      title: testCase.title,
      ok: res.ok && stage === "canvas" && missingFields.length === 0 && !json.error,
      httpStatus: res.status,
      elapsedMs: Date.now() - started,
      stage,
      summary: typeof result.summary === "string" ? result.summary : null,
      adpMode: typeof result.adpMode === "string" ? result.adpMode : null,
      missingFields,
      error: json.error ?? null,
      logTags: (json.logs ?? []).map((item) => item.tag),
    };
    rows.push(row);
    save(false);
    console.log(`${row.ok ? "OK" : "FAIL"} ${row.title} stage=${row.stage} ${row.elapsedMs}ms`);
    if (row.error) console.log("  ", row.error.slice(0, 240));
  }
  save(true);
  const passed = rows.filter((row) => row.ok).length;
  console.log(`done ${passed}/${rows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
