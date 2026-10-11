/**
 * 语料目录遍历：默认只走 <root>/docs/**\/*.md，并按规则排除。
 * 手写递归而非 fs.glob（后者在 Node 26 仍是实验特性，且这里要精确控制排序与排除统计）。
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export interface CorpusFile {
  absPath: string;
  /** 相对语料根的路径，如 "docs/API 文档/数据结构.md"。 */
  relPath: string;
  bytes: number;
}

export interface WalkResult {
  files: CorpusFile[];
  excluded: Array<{ relPath: string; reason: string }>;
}

export interface WalkOptions {
  /**
   * 相对语料根的子目录；`.` 表示语料根本身。
   * 不传时自动识别：有 `docs/` 就用 `docs/`（官方文档站点那种结构），
   * 没有就扫语料根本身（如手写笔记直接放在目录下）。
   */
  subdir?: string;
  /** 追加的排除模式（glob：* / ** / ?）。 */
  excludes?: string[];
}

/** 始终排除的目录片段（相对路径匹配）。 */
const ALWAYS_EXCLUDED_DIRS = ["_assets", "node_modules", ".git"];

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

/** 排除判定：目录名命中、相对路径命中、或 basename / 相对路径匹配任一 glob。 */
function isExcluded(relPath: string, isDir: boolean, patterns: RegExp[]): string | null {
  const segments = relPath.split(path.sep);
  const base = segments[segments.length - 1] ?? "";
  if (isDir && base.startsWith(".")) return "隐藏目录";
  if (isDir && ALWAYS_EXCLUDED_DIRS.includes(base)) return "内置排除目录";
  if (base === ".DS_Store") return "系统文件";
  for (const pattern of patterns) {
    if (pattern.test(relPath) || pattern.test(base)) return "排除规则";
  }
  return null;
}

/** 递归收集语料文件；结果按 relPath 排序，保证多次导入顺序稳定。 */
export function walkCorpus(root: string, options: WalkOptions = {}): WalkResult {
  const explicit = options.subdir?.trim();
  const subdir =
    explicit && explicit.length > 0 ? explicit : existsSync(path.join(root, "docs")) ? "docs" : ".";
  const patterns = (options.excludes ?? []).map(globToRegExp);
  const files: CorpusFile[] = [];
  const excluded: Array<{ relPath: string; reason: string }> = [];
  const startDir = subdir === "." ? root : path.join(root, subdir);

  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries.sort()) {
      const abs = path.join(dir, entry);
      const rel = path.relative(root, abs);
      let isDir = false;
      try {
        isDir = statSync(abs).isDirectory();
      } catch {
        continue;
      }
      const reason = isExcluded(rel, isDir, patterns);
      if (reason) {
        excluded.push({ relPath: rel, reason });
        continue;
      }
      if (isDir) {
        walk(abs);
        continue;
      }
      if (!entry.toLowerCase().endsWith(".md")) continue;
      let bytes = 0;
      try {
        bytes = statSync(abs).size;
      } catch {
        bytes = 0;
      }
      files.push({ absPath: abs, relPath: rel, bytes });
    }
  };

  walk(startDir);
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return { files, excluded };
}
