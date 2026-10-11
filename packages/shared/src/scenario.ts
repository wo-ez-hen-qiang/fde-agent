/**
 * 场景（scenario）= 一次对话要产出的东西。UI 侧常量集中在这里，
 * 让前端不再散落 `mode === "diagnosis" ? … : …` 这类三元。
 *
 * 注意：这里只放**无依赖的纯常量**，web 客户端可以安全 import；
 * LLM 侧的提示词/Schema/解析在 `@fde/agent-runtime` 的 scenarios 注册表里。
 */

export type ScenarioId = "chat" | "diagnosis" | "presales";

/** 有结构化输出的场景（chat 是自由文本，不在其中）。 */
export type StructuredScenarioId = Exclude<ScenarioId, "chat">;

export function isStructuredScenarioId(value: unknown): value is StructuredScenarioId {
  return value === "diagnosis" || value === "presales";
}

export function isScenarioId(value: unknown): value is ScenarioId {
  return value === "chat" || isStructuredScenarioId(value);
}

export interface ScenarioUiMeta {
  id: ScenarioId;
  /** 模式切换按钮上的文字。 */
  label: string;
  /** 是否必须选知识库才能提交。 */
  requiresKnowledgeBase: boolean;
  /** 输入框占位符。 */
  placeholder: string;
  /** 提交按钮文字。 */
  submitLabel: string;
  /** 知识库下拉为空时的首项文字。 */
  knowledgeEmptyOption: string;
  /** 未选知识库时的提示。 */
  knowledgeRequiredHint: string;
  /** 处理中状态文案（非流式场景用它替代逐字输出）。 */
  pendingText?: string;
}

export const SCENARIO_UI: Record<ScenarioId, ScenarioUiMeta> = {
  chat: {
    id: "chat",
    label: "普通问答",
    requiresKnowledgeBase: false,
    placeholder: "输入消息，Enter 发送，Shift+Enter 换行",
    submitLabel: "发送",
    knowledgeEmptyOption: "不使用",
    knowledgeRequiredHint: "",
  },
  diagnosis: {
    id: "diagnosis",
    label: "工单诊断",
    requiresKnowledgeBase: true,
    placeholder: "粘贴工单内容，Enter 开始诊断",
    submitLabel: "开始诊断",
    knowledgeEmptyOption: "请选择",
    knowledgeRequiredHint: "工单诊断需要先选择知识库。",
    pendingText: "正在检索知识库并生成诊断",
  },
  presales: {
    id: "presales",
    label: "售前方案",
    requiresKnowledgeBase: true,
    placeholder: "售前请填写下方受理表",
    submitLabel: "生成方案画布",
    knowledgeEmptyOption: "请选择",
    knowledgeRequiredHint: "售前方案需要先选择知识库。",
    pendingText: "正在检索知识库并生成方案",
  },
};

/** 模式切换按钮的顺序（也是 UI 上的展示顺序）。 */
export const SCENARIO_ORDER: ScenarioId[] = ["chat", "diagnosis", "presales"];

export function scenarioUi(id: ScenarioId): ScenarioUiMeta {
  return SCENARIO_UI[id];
}
