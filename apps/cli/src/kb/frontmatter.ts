/**
 * 极简 YAML frontmatter 解析（只服务本仓库要灌的语料）。
 *
 * 语料是抓取脚本生成的扁平 `key: value`（无嵌套、无引号、无注释、无锚点），
 * 因此不引入 yaml 依赖；遇到不合规的行**返回 null**，由调用方计入报告——
 * 宁可 fail loudly，也不要静默解析出错的元数据。
 */
import { createHash } from "node:crypto";

export type Frontmatter = Record<string, string>;

export interface ParsedDoc {
  data: Frontmatter;
  body: string;
}

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 解析 `---\n key: value …\n---\n正文`；无 frontmatter 或格式不合规返回 null。 */
export function parseFrontmatter(text: string): ParsedDoc | null {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== "---") return null;

  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) return null;

  const data: Frontmatter = {};
  for (const line of lines.slice(1, end)) {
    if (!line.trim()) continue;
    const idx = line.indexOf(": ");
    if (idx <= 0) return null;
    const key = line.slice(0, idx).trim();
    if (!KEY_RE.test(key)) return null;
    data[key] = line
      .slice(idx + 2)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return { data, body: lines.slice(end + 1).join("\n") };
}

/**
 * 正文指纹：title + 来源 URL + 规范化正文。
 * **刻意不含 updated_at / doc_type**：重新抓取时时间戳会变而正文未必变，
 * 用时间戳判断会白灌一遍（embedding 贵，hash 便宜三个数量级）。
 */
export function contentHash(parts: { title: string; sourceUrl: string; body: string }): string {
  const payload = `${parts.title}\n${parts.sourceUrl}\n${parts.body.replace(/\r\n/g, "\n").trim()}`;
  return createHash("sha256").update(payload).digest("hex");
}

/** 取正文首个 h1 作为标题（无 frontmatter 时的兜底）。 */
export function firstHeading(body: string): string | undefined {
  for (const line of body.split("\n")) {
    const match = /^#\s+(.+)$/.exec(line.trim());
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}
