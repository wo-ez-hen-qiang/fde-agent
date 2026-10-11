/**
 * 售前方案：FDE 三步流水线 —— 受理表 → 方案画布确认 → 6 段整案。
 *
 * 口径来自《腾讯云 ADP 前沿部署工程师 (FDE) 认证课程》：
 * 对外沟通 6 段式 + 方案画布 8 字段 + 模式选型四信号 + 风险评审 8 维度。
 * 硬约束：不编造数据、案例、效果数字与排期报价。
 */
import type { DiagnosisReference } from "./diagnosis.js";

/** @deprecated 旧追问维度；仅用于历史 clarify 消息展示。 */
export type PreSalesQuestionField = "industry" | "audience" | "problem" | "expectedOutput";

/** 本轮产出：画布草稿 或 整体方案报告。旧消息可能仍为 clarify。 */
export type PreSalesStage = "canvas" | "report" | "clarify";

/** 售前场景运行阶段（调用方显式传入）。 */
export type PreSalesPhase = "canvas" | "report";

/** @deprecated 旧追问结构。 */
export interface PreSalesQuestion {
  id: string;
  field: PreSalesQuestionField;
  question: string;
  why: string;
}

/** 表 A：客户基本情况（前端必填校验）。 */
export interface PreSalesIntake {
  customerName: string;
  industry: string;
  /** 多选枚举 key；含 other 时配合 audienceOther。 */
  audience: PreSalesAudienceValue[];
  audienceOther?: string;
  problem: PreSalesProblemValue[];
  problemOther?: string;
  expectedOutput: PreSalesExpectedOutputValue;
  expectedOutputOther?: string;
  sceneNarrative: string;
}

export type PreSalesAudienceValue =
  "employee" | "cs" | "ops" | "sales" | "customer" | "manager" | "other";

export type PreSalesProblemValue =
  "lowEfficiency" | "slowLookup" | "tooMuchManual" | "unstableProcess" | "poorUx" | "other";

export type PreSalesExpectedOutputValue = "qa" | "workflow" | "doc" | "riskList" | "demo" | "other";

/** 表 B：方案画布 8 字段（AI 草稿，FDE 全量可改）。 */
export interface PreSalesCanvas {
  statusQuo: string;
  businessGoal: string;
  entryPoint: string;
  adpMode: string;
  knowledgeAssets: string;
  processAndTools: string;
  inputOutput: string;
  boundaryAcceptance: string;
}

export interface PreSalesResult {
  scenario: "presales";
  stage: PreSalesStage;
  summary: string;
  /** @deprecated stage=clarify 遗留；新路径恒为空数组。 */
  questions: PreSalesQuestion[];
  /** 一、客户需求理解（stage=canvas 时为空）。 */
  needUnderstanding: string;
  industryOpportunity: string;
  recommendedSolution: string;
  demoScope: string;
  deliveryRisk: string;
  nextInfoNeeded: string;
  /** 方案画布（stage=canvas 必填；stage=report 带回确认版快照）。 */
  statusQuo: string;
  businessGoal: string;
  entryPoint: string;
  adpMode: string;
  knowledgeAssets: string;
  processAndTools: string;
  inputOutput: string;
  boundaryAcceptance: string;
  confidence: number;
  references: DiagnosisReference[];
  createdAt: number;
}

export const PRESALES_SECTIONS = [
  ["needUnderstanding", "一、客户需求理解"],
  ["industryOpportunity", "二、行业与场景机会"],
  ["recommendedSolution", "三、推荐智能体方案"],
  ["demoScope", "四、第一版 Demo 范围"],
  ["deliveryRisk", "五、交付风险与前置条件"],
  ["nextInfoNeeded", "六、下一步需要客户补充的信息"],
] as const satisfies ReadonlyArray<readonly [keyof PreSalesResult, string]>;

export const PRESALES_CANVAS_FIELDS = [
  ["statusQuo", "背景与现状"],
  ["businessGoal", "业务目标"],
  ["entryPoint", "用户与入口"],
  ["adpMode", "ADP 模式"],
  ["knowledgeAssets", "知识与资料"],
  ["processAndTools", "流程与工具"],
  ["inputOutput", "输入与输出"],
  ["boundaryAcceptance", "边界与验收"],
] as const satisfies ReadonlyArray<readonly [keyof PreSalesCanvas, string]>;

/** @deprecated */
export const PRESALES_FIELD_LABELS: Record<PreSalesQuestionField, string> = {
  industry: "行业",
  audience: "用户",
  problem: "问题",
  expectedOutput: "输出",
};

/** @deprecated 已由前端表单校验替代追问轮数。 */
export const PRESALES_MAX_CLARIFY_ROUNDS = 2;

export const PRESALES_AUDIENCE_OPTIONS: ReadonlyArray<{
  value: PreSalesAudienceValue;
  label: string;
}> = [
  { value: "employee", label: "员工" },
  { value: "cs", label: "客服" },
  { value: "ops", label: "运营" },
  { value: "sales", label: "销售" },
  { value: "customer", label: "客户" },
  { value: "manager", label: "管理者" },
  { value: "other", label: "其他" },
];

export const PRESALES_PROBLEM_OPTIONS: ReadonlyArray<{
  value: PreSalesProblemValue;
  label: string;
}> = [
  { value: "lowEfficiency", label: "效率低" },
  { value: "slowLookup", label: "查询慢" },
  { value: "tooMuchManual", label: "人工判断多" },
  { value: "unstableProcess", label: "流程不稳定" },
  { value: "poorUx", label: "体验差" },
  { value: "other", label: "其他" },
];

export const PRESALES_EXPECTED_OUTPUT_OPTIONS: ReadonlyArray<{
  value: PreSalesExpectedOutputValue;
  label: string;
}> = [
  { value: "qa", label: "问答助手" },
  { value: "workflow", label: "工作流" },
  { value: "doc", label: "方案文档" },
  { value: "riskList", label: "风险清单" },
  { value: "demo", label: "演示 Demo" },
  { value: "other", label: "其他" },
];

function labelOf<T extends string>(
  options: ReadonlyArray<{ value: T; label: string }>,
  value: T,
): string {
  return options.find((item) => item.value === value)?.label ?? value;
}

function formatMulti(
  values: string[],
  options: ReadonlyArray<{ value: string; label: string }>,
  other?: string,
): string {
  const parts = values.filter((value) => value !== "other").map((value) => labelOf(options, value));
  if (values.includes("other") && other?.trim()) parts.push(`其他：${other.trim()}`);
  else if (values.includes("other")) parts.push("其他");
  return parts.join("；") || "（未填）";
}

/** 表 A → Markdown 表（喂模型 / 落库用户消息）。 */
export function serializePresalesIntake(intake: PreSalesIntake): string {
  const audience = formatMulti(intake.audience, PRESALES_AUDIENCE_OPTIONS, intake.audienceOther);
  const problem = formatMulti(intake.problem, PRESALES_PROBLEM_OPTIONS, intake.problemOther);
  const expected =
    intake.expectedOutput === "other"
      ? `其他：${intake.expectedOutputOther?.trim() || "（未填）"}`
      : labelOf(PRESALES_EXPECTED_OUTPUT_OPTIONS, intake.expectedOutput);

  const rows: Array<[string, string]> = [
    ["客户名称", intake.customerName.trim()],
    ["行业/部门", intake.industry.trim()],
    ["目标用户", audience],
    ["当前问题", problem],
    ["期望输出", expected],
    ["场景一句话", intake.sceneNarrative.trim()],
  ];
  return [
    "# 售前受理表",
    "",
    "| 字段 | 内容 |",
    "|---|---|",
    ...rows.map(([k, v]) => `| ${k} | ${escapeCell(v)} |`),
  ].join("\n");
}

/** 表 A + 确认后的表 B → 整案输入。 */
export function serializePresalesBrief(intake: PreSalesIntake, canvas: PreSalesCanvas): string {
  const canvasRows = PRESALES_CANVAS_FIELDS.map(
    ([key, label]) => `| ${label} | ${escapeCell(canvas[key].trim() || "待客户确认")} |`,
  );
  return [
    serializePresalesIntake(intake),
    "",
    "# 已确认的方案画布（FDE 审定，整案必须以此为准）",
    "",
    "| 方案画布字段 | 内容 |",
    "|---|---|",
    ...canvasRows,
  ].join("\n");
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

export function emptyPresalesCanvas(): PreSalesCanvas {
  return {
    statusQuo: "",
    businessGoal: "",
    entryPoint: "",
    adpMode: "",
    knowledgeAssets: "",
    processAndTools: "",
    inputOutput: "",
    boundaryAcceptance: "",
  };
}

export function canvasFromResult(result: PreSalesResult): PreSalesCanvas {
  return {
    statusQuo: result.statusQuo ?? "",
    businessGoal: result.businessGoal ?? "",
    entryPoint: result.entryPoint ?? "",
    adpMode: result.adpMode ?? "",
    knowledgeAssets: result.knowledgeAssets ?? "",
    processAndTools: result.processAndTools ?? "",
    inputOutput: result.inputOutput ?? "",
    boundaryAcceptance: result.boundaryAcceptance ?? "",
  };
}

/** 前端表 A 校验；返回中文字段错误，空对象表示通过。 */
export function validatePresalesIntake(
  intake: PreSalesIntake,
): Partial<Record<keyof PreSalesIntake, string>> {
  const errors: Partial<Record<keyof PreSalesIntake, string>> = {};
  if (!intake.customerName.trim()) errors.customerName = "请填写客户名称";
  if (intake.industry.trim().length < 2) errors.industry = "请填写行业/部门（至少 2 字）";
  if (
    intake.audience.length === 0 ||
    (intake.audience.includes("other") && !intake.audienceOther?.trim())
  ) {
    if (intake.audience.length === 0) errors.audience = "请选择目标用户";
    else errors.audienceOther = "请填写「其他」用户说明";
  }
  if (intake.problem.length === 0) errors.problem = "请选择当前业务问题";
  else if (intake.problem.includes("other") && !intake.problemOther?.trim()) {
    errors.problemOther = "请填写「其他」问题说明";
  }
  if (!intake.expectedOutput) errors.expectedOutput = "请选择期望输出";
  else if (intake.expectedOutput === "other" && !intake.expectedOutputOther?.trim()) {
    errors.expectedOutputOther = "请填写「其他」期望输出";
  }
  if (intake.sceneNarrative.trim().length < 10) {
    errors.sceneNarrative = "请用一句话描述场景（至少 10 字）";
  }
  return errors;
}

export function extractCustomerNameFromIntakeMarkdown(text: string): string | undefined {
  const match = text.match(/\|\s*客户名称\s*\|\s*(.+?)\s*\|/);
  const name = match?.[1]?.replace(/<br>/g, " ").trim();
  return name && name !== "（未填）" ? name : undefined;
}
