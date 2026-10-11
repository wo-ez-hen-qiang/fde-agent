/**
 * 售前方案：受理表 → 画布草稿 → FDE 确认后整案。
 *
 * 结构与口径来自《腾讯云 ADP 前沿部署工程师 (FDE) 认证课程》。
 */
import { z } from "zod";
import {
  PRESALES_CANVAS_FIELDS,
  PRESALES_SECTIONS,
  type PreSalesPhase,
  type PreSalesResult,
  type ScenarioResult,
} from "@fde/shared";
import { extractJsonObject, validateStructured } from "./json.js";
import type { ScenarioDefinition } from "./types.js";
import { agentLog } from "../log.js";

const CANVAS_KEYS = [
  "statusQuo",
  "businessGoal",
  "entryPoint",
  "adpMode",
  "knowledgeAssets",
  "processAndTools",
  "inputOutput",
  "boundaryAcceptance",
] as const;

const PRESALES_BODY = `你是腾讯云智能体开发平台（ADP）的资深售前方案专家，为一线 FDE 服务。
输入已是标准化的「售前受理表」和/或「已确认方案画布」，不要再追问用户（禁止 stage=clarify，questions 必须为空数组 []）。

# 硬约束
- 不得编造数据、客户案例、效果数字、排期与报价；禁止金额与工期数字。
- 只能引用「知识库证据」中出现过的文档。
- 证据不足时 confidence 不得高于 0.5；缺失处写「待客户确认」。
- 全部字段使用简体中文。
- JSON 每个约定字段都必须出现，不要用 Markdown 代码围栏。

（注：JSON 字样必须保留——GLM/OpenAI 的 JSON 模式要求 prompt 中出现 "json"）`;

const PHASE_CANVAS = `# 本轮任务：生成方案画布草稿（stage 必须为 "canvas"）
根据受理表与知识库，填写方案画布 8 字段。JSON **键名必须用英文**（括号内为中文含义，不要用中文当键名）：
- statusQuo（背景与现状）
- businessGoal（业务目标）
- entryPoint（用户与入口）
- adpMode（ADP 模式）
- knowledgeAssets（知识与资料）
- processAndTools（流程与工具）
- inputOutput（输入与输出）
- boundaryAcceptance（边界与验收）
ADP 模式用课程四信号判断（流程固定→单工作流；稳定溯源→标准模式；多角色→Multi-Agent；文件/代码→Claw；仍在探索→智能工作台）。
必须包含 summary（一句话摘要，字符串）。
6 个报告正文字段（needUnderstanding / industryOpportunity / recommendedSolution / demoScope / deliveryRisk / nextInfoNeeded）全部输出空字符串 ""。
questions 必须为 []。不要输出其它键名（如 citedEvidence、中文键）。`;

const PHASE_REPORT = `# 本轮任务：生成整体方案报告（stage 必须为 "report"）
输入含「已确认的方案画布」时，第 3 段方案画布表必须与确认版一致，不得擅自改写已确认字段（可润色叙述文字）。
按 6 段输出（键名英文）：
1 needUnderstanding 客户需求理解
2 industryOpportunity 行业与场景机会（仅用知识库证据）
3 recommendedSolution 含 (a) 模式选型说明 (b) 方案画布 Markdown 表（8 行）；必须是字符串
4 demoScope 第一版 Demo 范围
5 deliveryRisk 风险等级 + 四列表（8 评审维度）；必须是字符串
6 nextInfoNeeded 下一步需补充信息
同时把确认后的画布 8 字段用英文键原样填回：statusQuo / businessGoal / entryPoint / adpMode / knowledgeAssets / processAndTools / inputOutput / boundaryAcceptance。
必须包含 summary。questions 必须为 []。不要输出中文键或其它键。`;

/** 模型常把画布字段写成中文键；校验前归一成约定英文键，并把非字符串正文压成字符串。 */
const CANVAS_KEY_ALIASES: Record<string, (typeof CANVAS_KEYS)[number]> = {
  背景与现状: "statusQuo",
  业务目标: "businessGoal",
  用户与入口: "entryPoint",
  "ADP 模式": "adpMode",
  ADP模式: "adpMode",
  知识与资料: "knowledgeAssets",
  流程与工具: "processAndTools",
  输入与输出: "inputOutput",
  边界与验收: "boundaryAcceptance",
};

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizePresalesRaw(raw: unknown): unknown {
  const candidate = extractJsonObject(raw);
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return candidate;
  }
  const source = candidate as Record<string, unknown>;
  const out: Record<string, unknown> = { ...source };
  const remapped: string[] = [];

  for (const [alias, key] of Object.entries(CANVAS_KEY_ALIASES)) {
    if (out[key] === undefined && source[alias] !== undefined) {
      out[key] = source[alias];
      remapped.push(`${alias}→${key}`);
    }
    delete out[alias];
  }
  if (remapped.length > 0) {
    agentLog(
      "presales:parse:normalize",
      `中文键映射 ${remapped.length} 项：${remapped.join("，")}`,
    );
  }

  // 丢弃 schema 外字段，避免干扰（citedEvidence 等）
  delete out.citedEvidence;
  delete out.references;

  if (out.summary === undefined || out.summary === null) {
    out.summary = asString(source.客户场景 ?? source.title ?? "售前方案画布草稿");
  }

  for (const key of [
    "summary",
    "needUnderstanding",
    "industryOpportunity",
    "recommendedSolution",
    "demoScope",
    "deliveryRisk",
    "nextInfoNeeded",
    ...CANVAS_KEYS,
  ]) {
    out[key] = asString(out[key]);
  }

  if (out.stage !== "canvas" && out.stage !== "report") {
    const reportFilled = [
      "needUnderstanding",
      "industryOpportunity",
      "recommendedSolution",
      "demoScope",
      "deliveryRisk",
      "nextInfoNeeded",
    ].some((key) => asString(out[key]).trim().length > 0);
    const canvasFilled = CANVAS_KEYS.some((key) => asString(out[key]).trim().length > 0);
    const hinted = asString(source.status ?? source.状态).toLowerCase();
    const inferred =
      hinted === "canvas" || hinted.includes("画布")
        ? "canvas"
        : hinted === "report" || hinted.includes("报告")
          ? "report"
          : reportFilled
            ? "report"
            : canvasFilled
              ? "canvas"
              : "";
    if (inferred) {
      out.stage = inferred;
      agentLog("presales:parse:normalize", `缺少 stage，按内容推断为 ${inferred}`);
    }
  }
  delete out.status;

  if (!Array.isArray(out.questions)) out.questions = [];
  if (typeof out.confidence !== "number") {
    const n = Number(out.confidence);
    out.confidence = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
  }

  return out;
}

const canvasFieldSchemas = Object.fromEntries(
  CANVAS_KEYS.map((key) => [
    key,
    {
      type: "string",
      description: `方案画布：${PRESALES_CANVAS_FIELDS.find(([k]) => k === key)?.[1] ?? key}；stage=report 时带回确认版`,
    },
  ]),
) as Record<(typeof CANVAS_KEYS)[number], { type: "string"; description: string }>;

const PRESALES_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "stage",
    "summary",
    "questions",
    "needUnderstanding",
    "industryOpportunity",
    "recommendedSolution",
    "demoScope",
    "deliveryRisk",
    "nextInfoNeeded",
    ...CANVAS_KEYS,
    "confidence",
  ],
  properties: {
    stage: {
      type: "string",
      enum: ["canvas", "report"],
      description: "canvas=画布草稿；report=6 段整案",
    },
    summary: { type: "string", description: "一句话说明本轮产出" },
    questions: {
      type: "array",
      description: "必须为空数组",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "field", "question", "why"],
        properties: {
          id: { type: "string" },
          field: { type: "string", enum: ["industry", "audience", "problem", "expectedOutput"] },
          question: { type: "string" },
          why: { type: "string" },
        },
      },
    },
    needUnderstanding: { type: "string", description: "一、客户需求理解；canvas 时为空字符串" },
    industryOpportunity: { type: "string", description: "二、行业与场景机会；canvas 时为空字符串" },
    recommendedSolution: { type: "string", description: "三、推荐智能体方案；canvas 时为空字符串" },
    demoScope: { type: "string", description: "四、第一版 Demo；canvas 时为空字符串" },
    deliveryRisk: { type: "string", description: "五、交付风险；canvas 时为空字符串" },
    nextInfoNeeded: { type: "string", description: "六、下一步信息；canvas 时为空字符串" },
    ...canvasFieldSchemas,
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

const canvasZod = {
  statusQuo: z.string(),
  businessGoal: z.string(),
  entryPoint: z.string(),
  adpMode: z.string(),
  knowledgeAssets: z.string(),
  processAndTools: z.string(),
  inputOutput: z.string(),
  boundaryAcceptance: z.string(),
};

const presalesOutputSchema = z.object({
  stage: z.enum(["canvas", "report"]),
  summary: z.string(),
  questions: z.array(
    z.object({
      id: z.string(),
      field: z.enum(["industry", "audience", "problem", "expectedOutput"]),
      question: z.string(),
      why: z.string(),
    }),
  ),
  needUnderstanding: z.string(),
  industryOpportunity: z.string(),
  recommendedSolution: z.string(),
  demoScope: z.string(),
  deliveryRisk: z.string(),
  nextInfoNeeded: z.string(),
  ...canvasZod,
  confidence: z.number().min(0).max(1),
});

const PRESALES_QUERIES = [
  "智能体应用及其四种模式 标准模式 单工作流 Multi-Agent Claw 智能工作台 适用场景",
  "知识库 问答对 拒答 召回 测试集 评测验收 交付",
  "行业 智能体 落地场景 痛点 核心指标 边界 合规",
];

function resolvePhase(opts: {
  forceReport?: boolean;
  presalesPhase?: PreSalesPhase;
}): PreSalesPhase {
  if (opts.presalesPhase === "canvas" || opts.presalesPhase === "report") return opts.presalesPhase;
  return opts.forceReport ? "report" : "canvas";
}

export const presalesScenario: ScenarioDefinition = {
  id: "presales",
  label: "售前方案",
  requiresKnowledgeBase: true,
  instructions: `${PRESALES_BODY}

# 工具
先调用 search_knowledge_base 检索 ADP 平台能力与行业口径（至少一次，可换关键词多次检索），
再输出结构化结果。

# 输出
最终只输出符合约定字段的 JSON 对象，不要使用 Markdown 代码围栏。
本轮具体是 canvas 还是 report，以用户消息中的「本轮任务」为准。`,
  systemPrompt: `${PRESALES_BODY}

# 输出
只输出符合约定字段的 JSON，不要使用 Markdown 代码围栏。
本轮具体是 canvas 还是 report，以用户消息中的「本轮任务」为准。`,
  outputSchema: presalesOutputSchema,
  jsonSchema: PRESALES_JSON_SCHEMA,
  retrieval: {
    queries: (input) => [input.slice(0, 300), ...PRESALES_QUERIES],
    task: (input, opts) => {
      const phase = resolvePhase(opts);
      return [
        phase === "canvas" ? PHASE_CANVAS : PHASE_REPORT,
        `输入材料：\n${input}`,
        "只输出符合约定字段的 JSON，不要使用 Markdown 代码围栏。",
      ].join("\n\n");
    },
  },
  parse: (raw, references): PreSalesResult => {
    agentLog("presales:parse", "开始解析结构化输出");
    const output = validateStructured(presalesOutputSchema, normalizePresalesRaw(raw), "售前方案");
    const isCanvas = output.stage === "canvas";
    agentLog(
      isCanvas ? "scenario:presales:canvas" : "scenario:presales:report",
      isCanvas ? "画布字段已解析" : "整体方案已解析",
    );
    return {
      scenario: "presales",
      ...output,
      questions: [],
      ...(isCanvas
        ? {
            needUnderstanding: "",
            industryOpportunity: "",
            recommendedSolution: "",
            demoScope: "",
            deliveryRisk: "",
            nextInfoNeeded: "",
          }
        : {}),
      references,
      createdAt: Date.now(),
    };
  },
  renderMarkdown: (result: ScenarioResult): string => {
    const report = result as PreSalesResult;
    if (report.stage === "clarify") {
      const questions = (report.questions ?? [])
        .map((q, i) => `${i + 1}. ${q.question}\n   （为什么需要：${q.why}）`)
        .join("\n");
      return `**售前方案 · 需要补充信息（历史）**\n\n${report.summary}\n\n${questions}`;
    }

    if (report.stage === "canvas") {
      const table = [
        "| 方案画布字段 | 内容 |",
        "|---|---|",
        ...PRESALES_CANVAS_FIELDS.map(
          ([key, label]) => `| ${label} | ${(report[key] || "待确认").replace(/\n/g, "<br>")} |`,
        ),
      ].join("\n");
      return [
        "# 方案画布草稿",
        `> ${report.summary}`,
        `> 置信度：${Math.round(report.confidence * 100)}%　|　引用 ${report.references.length} 条`,
        "",
        table,
        "",
        "## 参考资料",
        "",
        report.references.length > 0
          ? report.references
              .map(
                (ref, i) =>
                  `${i + 1}. **${ref.documentTitle}**（相关度 ${ref.score.toFixed(2)}）\n   > ${ref.excerpt.replace(/\n/g, " ").slice(0, 200)}`,
              )
              .join("\n")
          : "知识库没有找到相关依据。",
      ].join("\n");
    }

    const body = PRESALES_SECTIONS.map(([key, title]) => `## ${title}\n\n${report[key]}`).join(
      "\n\n",
    );
    const references =
      report.references.length > 0
        ? report.references
            .map(
              (ref, i) =>
                `${i + 1}. **${ref.documentTitle}**（相关度 ${ref.score.toFixed(2)}）\n   > ${ref.excerpt.replace(/\n/g, " ").slice(0, 200)}`,
            )
            .join("\n")
        : "知识库没有找到相关依据。";

    return [
      "# 基于腾讯云 ADP 平台的销售方案报告",
      `> 客户场景：${report.summary}`,
      `> 置信度：${Math.round(report.confidence * 100)}%　|　引用知识库证据 ${report.references.length} 条`,
      body,
      `## 参考资料\n\n${references}`,
    ].join("\n\n");
  },
};

/** 供 api 后端把 phase 指令拼进用户输入（api 不走 preparePrompt）。 */
export function presalesPhasePrefix(phase: PreSalesPhase): string {
  return phase === "canvas" ? PHASE_CANVAS : PHASE_REPORT;
}

export function resolvePresalesPhase(request: {
  forceReport?: boolean;
  presalesPhase?: PreSalesPhase;
}): PreSalesPhase {
  return resolvePhase(request);
}
