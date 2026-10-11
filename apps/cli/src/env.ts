/**
 * 加载仓库根目录的 .env。
 *
 * 现状：仓库把配置放在根 `.env`，但没有任何进程主动加载它（Next 只读它自己项目目录下的
 * `.env*`），于是 `fde kb` / `fde chat` 拿不到 FDE_EMBEDDING_* 等变量。这里在 CLI 启动
 * 最早期读一次，已存在的环境变量优先（不覆盖 shell 里显式 export 的值）。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/** 从 start 向上找含 pnpm-workspace.yaml 的目录（最多 6 层）。 */
export function repoRoot(start: string = process.cwd()): string | null {
  let dir = path.resolve(start);
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** 加载仓库根 .env；返回实际加载的文件路径（没找到则 null）。 */
export function loadRepoEnv(cwd: string = process.cwd()): string | null {
  const root = repoRoot(cwd);
  if (!root) return null;
  const envPath = path.join(root, ".env");
  if (!existsSync(envPath)) return null;
  let parsed: Record<string, string>;
  try {
    parsed = parseEnvFile(readFileSync(envPath, "utf8"));
  } catch {
    return null;
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return envPath;
}

/** 启动时立即加载（模块副作用），供命令回显来源。 */
export const repoEnvPath = loadRepoEnv();
