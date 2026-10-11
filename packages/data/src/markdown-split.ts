/**
 * Markdown-aware splitter for structured documents (API docs, handbooks).
 *
 * 与 `splitText` 的区别：按标题层级切、表格与代码块整块原子、每块带
 * 「文档 › 小节」上下文前缀。用于导入结构化语料；`splitText` 仍是默认路径。
 */

export interface HeadingPath {
  level: number;
  text: string;
}

export interface MarkdownSplitContext {
  /** 文档标题（frontmatter.title 或首个 h1）。 */
  title?: string;
  /** frontmatter.breadcrumb，如 "API 文档 / 知识库相关接口"。 */
  breadcrumb?: string;
}

export interface MarkdownSplitOptions {
  /** 软目标块长（字符，含前缀）。默认 max × 0.75。 */
  target?: number;
  /** 硬上限（字符，含前缀）；表格/代码块无法再小时允许超出。默认 1400。 */
  max?: number;
  /** 块间重叠字符数；markdown 模式默认 0（按标题切出的块本身自洽）。 */
  overlap?: number;
  /** 自定义前缀渲染；返回空串即不加前缀。 */
  contextPrefix?: (path: HeadingPath[], ctx: MarkdownSplitContext) => string;
}

export interface MarkdownChunk {
  /** 最终入库文本（含上下文前缀）。 */
  content: string;
  /** h1 → 当前块的标题路径。 */
  headingPath: HeadingPath[];
  kind: "prose" | "table" | "code";
  /** 在原文中的起始偏移，便于回溯。 */
  start: number;
}

type Block =
  | { kind: "heading"; level: number; text: string; start: number }
  | { kind: "fence"; text: string; start: number }
  | { kind: "table"; rows: string[]; start: number }
  | { kind: "para"; text: string; start: number };

const DEFAULT_MAX = 1400;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;

/** 表格的分隔行（| --- | :--: |），用于识别表头第二行。 */
function isTableSeparator(row: string): boolean {
  return /^\s*\|[\s:|-]+\|\s*$/.test(row) && row.includes("-");
}

/** 段落内部的降级切分：先按句末标点，再按硬字符数。 */
function splitParagraph(text: string, budget: number): string[] {
  if (text.length <= budget) return [text];
  const parts: string[] = [];
  let buffer = "";
  for (const piece of text.split(/(?<=[。！？；\n])/)) {
    if (piece.length > budget) {
      if (buffer) {
        parts.push(buffer);
        buffer = "";
      }
      for (let i = 0; i < piece.length; i += budget) parts.push(piece.slice(i, i + budget));
      continue;
    }
    if (buffer.length + piece.length > budget) {
      parts.push(buffer);
      buffer = piece;
    } else {
      buffer += piece;
    }
  }
  if (buffer) parts.push(buffer);
  return parts.filter((part) => part.trim().length > 0);
}

/**
 * 超长表格按行切；每个片段重复表头（列名 + 分隔行）并标注「续表」。
 * 单行本身就超预算时只能硬切，此时不再重复表头（避免表头比内容还长）。
 */
function splitTable(rows: string[], budget: number): string[] {
  const header = rows.length > 1 && isTableSeparator(rows[1] ?? "") ? rows.slice(0, 2) : [];
  const body = rows.slice(header.length);
  const headerText = header.join("\n");
  const parts: string[] = [];
  let buffer: string[] = [];
  let bufferLen = headerText.length + 1;

  const flush = () => {
    if (buffer.length === 0) return;
    const text = buffer.join("\n");
    parts.push(headerText ? `${headerText}\n${text}` : text);
    buffer = [];
    bufferLen = headerText.length + 1;
  };

  for (const row of body) {
    if (row.length + 1 > budget) {
      flush();
      for (let i = 0; i < row.length; i += budget) parts.push(row.slice(i, i + budget));
      continue;
    }
    if (bufferLen + row.length + 1 > budget) flush();
    buffer.push(row);
    bufferLen += row.length + 1;
  }
  flush();

  const continued = parts.map((part, i) =>
    i === 0 ? part : `（续表 ${i + 1}/${parts.length}）\n${part}`,
  );
  return continued.length > 0 ? continued : [rows.join("\n")];
}

/** 超长代码块按行切，不重复任何内容（重复会污染向量）。 */
function splitFence(text: string, budget: number): string[] {
  if (text.length <= budget) return [text];
  const lines = text.split("\n");
  const parts: string[] = [];
  let buffer: string[] = [];
  let bufferLen = 0;
  const flush = () => {
    if (buffer.length === 0) return;
    parts.push(buffer.join("\n"));
    buffer = [];
    bufferLen = 0;
  };
  for (const line of lines) {
    // 单行本身超预算（典型的是一整段 JSON 被压成一行）：先冲掉缓冲，再硬切这一行，
    // 否则这一行会以原样进入某个块，撑爆模型输入上限（GLM 会直接 400）。
    if (line.length + 1 > budget) {
      flush();
      for (let i = 0; i < line.length; i += budget) parts.push(line.slice(i, i + budget));
      continue;
    }
    if (bufferLen + line.length + 1 > budget) flush();
    buffer.push(line);
    bufferLen += line.length + 1;
  }
  flush();
  return parts.length > 0 ? parts : [text];
}

/** 行级状态机：围栏代码块内不识别标题与表格。 */
function parseBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let offset = 0;
  let i = 0;

  const pushParagraph = (buffer: string[], start: number) => {
    const joined = buffer.join("\n").trim();
    if (joined) blocks.push({ kind: "para", text: joined, start });
  };

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const lineStart = offset;
    offset += line.length + 1;

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1] ?? "```";
      const collected = [line];
      i += 1;
      while (i < lines.length) {
        const inner = lines[i] ?? "";
        offset += inner.length + 1;
        collected.push(inner);
        i += 1;
        if (inner.trim().startsWith(marker.slice(0, 3))) break;
      }
      blocks.push({ kind: "fence", text: collected.join("\n"), start: lineStart });
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: (heading[1] ?? "#").length,
        text: (heading[2] ?? "").trim(),
        start: lineStart,
      });
      i += 1;
      continue;
    }

    if (TABLE_ROW_RE.test(line)) {
      const rows: string[] = [];
      while (i < lines.length && TABLE_ROW_RE.test(lines[i] ?? "")) {
        rows.push((lines[i] ?? "").trim());
        offset += (lines[i] ?? "").length + 1;
        i += 1;
      }
      blocks.push({ kind: "table", rows, start: lineStart });
      continue;
    }

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const buffer: string[] = [];
    const paraStart = lineStart;
    while (i < lines.length) {
      const inner = lines[i] ?? "";
      if (
        inner.trim() === "" ||
        HEADING_RE.test(inner) ||
        FENCE_RE.test(inner) ||
        TABLE_ROW_RE.test(inner)
      ) {
        break;
      }
      buffer.push(inner);
      offset += inner.length + 1;
      i += 1;
    }
    pushParagraph(buffer, paraStart);
  }

  return blocks;
}

/** 默认前缀：`【<title> › <h2> › <h3>】`（跳过与文档标题重复的 h1）。 */
export function defaultContextPrefix(path: HeadingPath[], ctx: MarkdownSplitContext): string {
  const parts: string[] = [];
  if (ctx.title) parts.push(ctx.title);
  for (const node of path) {
    if (node.level === 1 && ctx.title && node.text === ctx.title) continue;
    if (parts[parts.length - 1] === node.text) continue;
    parts.push(node.text);
  }
  return parts.length > 0 ? `【${parts.join(" › ")}】` : "";
}

/**
 * Split Markdown into retrieval-friendly chunks.
 * 不跨节打包：每块的内容都来自同一个标题路径下。
 */
export function splitMarkdown(
  text: string,
  options: MarkdownSplitOptions = {},
  context: MarkdownSplitContext = {},
): MarkdownChunk[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const max = options.max && options.max > 0 ? options.max : DEFAULT_MAX;
  const target = options.target && options.target > 0 ? options.target : Math.round(max * 0.75);
  const renderPrefix = options.contextPrefix ?? defaultContextPrefix;

  const blocks = parseBlocks(normalized);
  const chunks: MarkdownChunk[] = [];
  const stack: HeadingPath[] = [];

  // 当前正在打包的一节
  let path: HeadingPath[] = [];
  let prefix = "";
  let buffer: string[] = [];
  let bufferKind: MarkdownChunk["kind"] = "prose";
  let bufferStart = 0;

  const budget = () => Math.max(64, target - prefix.length);
  const hardBudget = () => Math.max(64, max - prefix.length);

  const flush = () => {
    const body = buffer.join("\n\n").trim();
    if (!body) {
      buffer = [];
      return;
    }
    chunks.push({
      content: prefix ? `${prefix}\n${body}` : body,
      headingPath: [...path],
      kind: bufferKind,
      start: bufferStart,
    });
    buffer = [];
  };

  const emit = (pieces: string[], kind: MarkdownChunk["kind"], start: number) => {
    for (const piece of pieces) {
      const body = piece.trim();
      if (!body) continue;
      chunks.push({
        content: prefix ? `${prefix}\n${body}` : body,
        headingPath: [...path],
        kind,
        start,
      });
    }
  };

  for (const block of blocks) {
    if (block.kind === "heading") {
      flush();
      while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= block.level) stack.pop();
      stack.push({ level: block.level, text: block.text });
      path = [...stack];
      prefix = renderPrefix(path, context);
      bufferStart = block.start;
      // 标题本身不再单独成块：它已经进了后续块的前缀。
      continue;
    }

    const body =
      block.kind === "para"
        ? block.text
        : block.kind === "table"
          ? block.rows.join("\n")
          : block.text;
    const kind: MarkdownChunk["kind"] =
      block.kind === "table" ? "table" : block.kind === "fence" ? "code" : "prose";

    if (buffer.length === 0) {
      bufferKind = kind;
      bufferStart = block.start;
    }

    // 单块自身就超硬上限：先把已有缓冲冲出去，再降级切分该块
    if (body.length > hardBudget()) {
      flush();
      const pieces =
        block.kind === "table"
          ? splitTable(block.rows, hardBudget())
          : block.kind === "fence"
            ? splitFence(body, hardBudget())
            : splitParagraph(body, hardBudget());
      emit(pieces, kind, block.start);
      continue;
    }

    const current = buffer.join("\n\n");
    if (current.length > 0 && current.length + body.length + 2 > budget()) {
      flush();
      bufferKind = kind;
      bufferStart = block.start;
    }
    buffer.push(body);
  }

  flush();
  return chunks;
}
