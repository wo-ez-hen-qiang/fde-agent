/**
 * 语料导入编排：扫描 → 逐篇 upsert → 汇总。
 * 幂等由 store.upsertDocument 保证（externalId + contentHash），这里只负责
 * 读取文件、组装元数据、收集报告与 prune。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { KnowledgeStore, UpsertOutcome } from "@fde/data";
import { contentHash, firstHeading, parseFrontmatter } from "./frontmatter.js";
import { walkCorpus } from "./walk.js";

export interface ImportOptions {
  knowledgeBaseId: string;
  /** 语料根目录（其下有 docs/）。 */
  root: string;
  subdir?: string;
  excludes?: string[];
  force?: boolean;
  dryRun?: boolean;
  prune?: boolean;
  limit?: number;
  chunkTarget?: number;
  chunkMax?: number;
  onEvent?: (event: ImportEvent) => void;
}

export type ImportEvent =
  | { type: "scan"; total: number; excluded: number }
  | {
      type: "doc";
      index: number;
      total: number;
      relPath: string;
      status: UpsertOutcome["status"];
      chunks: number;
      ms: number;
      fallback: boolean;
    }
  | { type: "error"; relPath: string; message: string };

export interface ImportReport {
  scanned: number;
  created: number;
  updated: number;
  refreshed: number;
  skipped: number;
  failed: number;
  pruned: number;
  chunks: number;
  /** 无 frontmatter、按路径兜底入库的篇数（如 INDEX.md）。 */
  noFrontmatter: number;
  ms: number;
  errors: Array<{ relPath: string; message: string }>;
}

/** 单篇文档的导入载荷（从文件内容推导）。 */
interface DocPayload {
  title: string;
  externalId: string;
  hash: string;
  metadata: Record<string, unknown>;
  body: string;
  fallback: boolean;
}

function buildPayload(relPath: string, text: string): DocPayload {
  const parsed = parseFrontmatter(text);
  const body = parsed ? parsed.body : text;
  const data = parsed?.data ?? {};
  const title = data.title ?? firstHeading(body) ?? path.basename(relPath, ".md");
  const sourceUrl = data.source ?? "";

  const metadata: Record<string, unknown> = { relPath };
  if (data.section) metadata.section = data.section;
  // 无 frontmatter 的文档（手写笔记等）用首个 h1 当栏目，便于 kb info 归类
  else if (!parsed) metadata.section = firstHeading(body) ?? path.basename(relPath, ".md");
  if (data.breadcrumb) metadata.breadcrumb = data.breadcrumb;
  if (data.doc_type) metadata.docType = data.doc_type;
  if (data.updated_at) metadata.updatedAt = data.updated_at;
  if (sourceUrl) metadata.sourceUrl = sourceUrl;

  return {
    title,
    // 有 doc_id 用 doc_id（跨目录稳定、与 manifest.json 对齐）；否则退回按路径
    externalId: data.doc_id ? `adp:${data.doc_id}` : `file:${relPath}`,
    hash: contentHash({ title, sourceUrl, body }),
    metadata,
    body,
    fallback: !parsed,
  };
}

/**
 * 导入整批语料。单篇失败只记录、不中断；返回汇总报告。
 * dryRun 时只扫描 + 比对（预测 created/updated/skipped），不写库、不算向量。
 */
export async function importCorpus(
  store: KnowledgeStore,
  options: ImportOptions,
): Promise<ImportReport> {
  const startedAt = Date.now();
  const report: ImportReport = {
    scanned: 0,
    created: 0,
    updated: 0,
    refreshed: 0,
    skipped: 0,
    failed: 0,
    pruned: 0,
    chunks: 0,
    noFrontmatter: 0,
    ms: 0,
    errors: [],
  };

  const walk = walkCorpus(options.root, { subdir: options.subdir, excludes: options.excludes });
  const files = options.limit ? walk.files.slice(0, options.limit) : walk.files;
  report.scanned = files.length;
  options.onEvent?.({ type: "scan", total: files.length, excluded: walk.excluded.length });

  // 现有键（用于 dry-run 预测与 prune 判定）
  const existingKeys = await store.listDocumentKeys(options.knowledgeBaseId, { source: "import" });
  const seen = new Set<string>();

  const chunkOptions: { target?: number; max?: number } = {};
  const max = options.chunkMax ?? store.maxInputChars;
  if (max) chunkOptions.max = max;
  if (options.chunkTarget) chunkOptions.target = options.chunkTarget;

  for (const [index, file] of files.entries()) {
    const docStartedAt = Date.now();
    let payload: DocPayload;
    try {
      payload = buildPayload(file.relPath, readFileSync(file.absPath, "utf8"));
    } catch (error) {
      report.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      report.errors.push({ relPath: file.relPath, message });
      options.onEvent?.({ type: "error", relPath: file.relPath, message });
      continue;
    }

    seen.add(payload.externalId);
    if (payload.fallback) report.noFrontmatter += 1;

    if (options.dryRun) {
      const existing = existingKeys.get(payload.externalId);
      const status: UpsertOutcome["status"] = !existing
        ? "created"
        : !options.force && existing.contentHash === payload.hash
          ? "skipped"
          : "updated";
      report[status === "created" ? "created" : status === "skipped" ? "skipped" : "updated"] += 1;
      options.onEvent?.({
        type: "doc",
        index: index + 1,
        total: files.length,
        relPath: file.relPath,
        status,
        chunks: 0,
        ms: Date.now() - docStartedAt,
        fallback: payload.fallback,
      });
      continue;
    }

    try {
      const outcome = await store.upsertDocument(
        options.knowledgeBaseId,
        payload.title,
        payload.body,
        {
          externalId: payload.externalId,
          contentHash: payload.hash,
          metadata: payload.metadata,
          source: "import",
          mimeType: "text/markdown",
          splitter: "markdown",
          chunk: Object.keys(chunkOptions).length > 0 ? chunkOptions : undefined,
          force: options.force === true,
        },
      );
      report[outcome.status] += 1;
      // 只统计真正写入的块：skipped / refreshed 没有产生新的 chunk
      if (outcome.status === "created" || outcome.status === "updated") {
        report.chunks += outcome.chunks;
      }
      options.onEvent?.({
        type: "doc",
        index: index + 1,
        total: files.length,
        relPath: file.relPath,
        status: outcome.status,
        chunks: outcome.chunks,
        ms: Date.now() - docStartedAt,
        fallback: payload.fallback,
      });
    } catch (error) {
      report.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      report.errors.push({ relPath: file.relPath, message });
      options.onEvent?.({ type: "error", relPath: file.relPath, message });
    }
  }

  if (options.prune) {
    for (const [externalId, entry] of existingKeys) {
      if (seen.has(externalId)) continue;
      report.pruned += 1;
      if (options.dryRun) continue;
      try {
        await store.deleteDocument(options.knowledgeBaseId, entry.id);
      } catch (error) {
        report.failed += 1;
        report.errors.push({
          relPath: externalId,
          message: `prune 失败：${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }

  report.ms = Date.now() - startedAt;
  return report;
}
