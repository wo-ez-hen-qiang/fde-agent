/**
 * 场景注册表：一个场景 = 一次对话要产出的东西。
 *
 * 加场景只需在这里加一个定义（提示词、Schema、解析、Markdown 渲染），
 * 三个后端与 web/CLI 都从注册表取用，不再各自散落 if/三元。
 */
import type { z } from "zod";
import type { DiagnosisReference, ScenarioId, ScenarioResult } from "@fde/shared";

export interface ScenarioRetrieval {
  /** 前置检索（claude/codex 路径）用哪些 query；默认应回落到整段输入。 */
  queries(input: string): string[];
  /** 证据之后的任务段。 */
  task(input: string, opts: { forceReport?: boolean; presalesPhase?: "canvas" | "report" }): string;
}

export interface ScenarioDefinition {
  id: ScenarioId;
  label: string;
  /** 是否必须先选知识库。 */
  requiresKnowledgeBase: boolean;
  /** api 路径：Agent 的 instructions（工具使用视角）。 */
  instructions: string;
  /** claude/codex 路径：CLI 的 --system-prompt。 */
  systemPrompt: string;
  /** 结构化输出（api 路径用 zod；另两个走 jsonSchema）。chat 场景为空。 */
  outputSchema?: z.ZodTypeAny;
  jsonSchema?: Record<string, unknown>;
  retrieval: ScenarioRetrieval;
  /** 模型原始输出 → 结构化结果（chat 场景为空）。 */
  parse?: (raw: unknown, references: DiagnosisReference[]) => ScenarioResult;
  /** 结构化结果 → 持久化与导出的 Markdown（唯一真源，页面与下载共用）。 */
  renderMarkdown?: (result: ScenarioResult) => string;
}
