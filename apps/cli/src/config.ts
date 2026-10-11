import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { AgentBackendId } from "@fde/shared";
import { defaultAgentBackendId, isAgentBackendId } from "@fde/agent-runtime";

export interface FdeCliConfig {
  /** Active backend id. */
  backend: AgentBackendId;
  /** Model alias for the api backend, e.g. "glm:glm-4.6". */
  model: string;
  /** Default knowledge base for diagnose. */
  knowledgeBaseId?: string;
}

function defaultConfig(): FdeCliConfig {
  return {
    backend: defaultAgentBackendId(),
    model: process.env.FDE_DEFAULT_MODEL ?? "glm:glm-4.6",
  };
}

export function configDir(): string {
  return path.join(homedir(), ".fde");
}

export function configPath(): string {
  return path.join(configDir(), "config.json");
}

export function loadConfig(): FdeCliConfig {
  const defaults = defaultConfig();
  try {
    if (existsSync(configPath())) {
      const raw = JSON.parse(readFileSync(configPath(), "utf8")) as Partial<FdeCliConfig>;
      const backend = isAgentBackendId(raw.backend) ? raw.backend : defaults.backend;
      return {
        ...defaults,
        ...raw,
        backend,
      };
    }
  } catch {
    console.error("[cli] 配置文件损坏，使用默认配置");
  }
  return { ...defaults };
}

export function saveConfig(patch: Partial<FdeCliConfig>): FdeCliConfig {
  const next = { ...loadConfig(), ...patch };
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(next, null, 2) + "\n");
  return next;
}
