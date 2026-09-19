import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface FdeCliConfig {
  /** Active backend id: "api" | "claude-cli" | "codex-cli" | "cursor-cli". */
  backend: string;
  /** CLI backends only: reuse the CLI's subscription login, or inject an API key. */
  cliAuth: "subscription" | "apikey";
  /** Model alias for the api backend, e.g. "glm:glm-4.6". */
  model: string;
  /** Default knowledge base for diagnose. */
  knowledgeBaseId?: string;
}

const DEFAULT_CONFIG: FdeCliConfig = {
  backend: "api",
  cliAuth: "subscription",
  model: process.env.FDE_DEFAULT_MODEL ?? "glm:glm-4.6",
};

export function configDir(): string {
  return path.join(homedir(), ".fde");
}

export function configPath(): string {
  return path.join(configDir(), "config.json");
}

export function loadConfig(): FdeCliConfig {
  try {
    if (existsSync(configPath())) {
      return { ...DEFAULT_CONFIG, ...(JSON.parse(readFileSync(configPath(), "utf8")) as Partial<FdeCliConfig>) };
    }
  } catch {
    console.error("[cli] 配置文件损坏，使用默认配置");
  }
  return { ...DEFAULT_CONFIG };
}

export function saveConfig(patch: Partial<FdeCliConfig>): FdeCliConfig {
  const next = { ...loadConfig(), ...patch };
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(next, null, 2) + "\n");
  return next;
}
