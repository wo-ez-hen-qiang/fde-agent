import type { ModelDescriptor, ProviderConfig, ProviderId } from "@fde/shared";

/**
 * Static catalog of known models. An alias is only *enabled* when the
 * corresponding credentials exist in the environment, so traffic switching
 * is purely a config concern - no code changes needed.
 */
const CATALOG: Array<{
  provider: ProviderId;
  model: string;
  label: string;
  capabilities?: ModelDescriptor["capabilities"];
}> = [
  // GLM (Zhipu)
  {
    provider: "glm",
    model: "glm-4.6",
    label: "GLM-4.6",
    capabilities: { streaming: true, tools: true, reasoning: true },
  },
  {
    provider: "glm",
    model: "glm-4.5-flash",
    label: "GLM-4.5 Flash",
    capabilities: { streaming: true, tools: true },
  },
  // DeepSeek
  {
    provider: "deepseek",
    model: "deepseek-chat",
    label: "DeepSeek V3",
    capabilities: { streaming: true, tools: true },
  },
  {
    provider: "deepseek",
    model: "deepseek-reasoner",
    label: "DeepSeek R1",
    capabilities: { streaming: true, tools: false, reasoning: true },
  },
  // OpenAI
  {
    provider: "openai",
    model: "gpt-4o",
    label: "GPT-4o",
    capabilities: { streaming: true, tools: true },
  },
  {
    provider: "openai",
    model: "gpt-4o-mini",
    label: "GPT-4o mini",
    capabilities: { streaming: true, tools: true },
  },
  // Anthropic
  {
    provider: "claude",
    model: "claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    capabilities: { streaming: true, tools: true, reasoning: true },
  },
  {
    provider: "claude",
    model: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    capabilities: { streaming: true, tools: true },
  },
];

export interface EnvLike {
  [key: string]: string | undefined;
}

const PROVIDER_ENV: Record<
  ProviderId,
  { apiKey: string; baseUrl: string; defaultBaseUrl?: string }
> = {
  glm: {
    apiKey: "GLM_API_KEY",
    baseUrl: "GLM_BASE_URL",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
  },
  deepseek: {
    apiKey: "DEEPSEEK_API_KEY",
    baseUrl: "DEEPSEEK_BASE_URL",
    defaultBaseUrl: "https://api.deepseek.com",
  },
  openai: {
    apiKey: "OPENAI_API_KEY",
    baseUrl: "OPENAI_BASE_URL",
    defaultBaseUrl: "https://api.openai.com/v1",
  },
  claude: {
    apiKey: "ANTHROPIC_API_KEY",
    baseUrl: "ANTHROPIC_BASE_URL",
    defaultBaseUrl: "https://api.anthropic.com",
  },
  // "cursor" traffic is carried by the cursor-cli backend, not an HTTP API.
  cursor: { apiKey: "CURSOR_API_KEY", baseUrl: "CURSOR_BASE_URL" },
};

export function aliasOf(provider: ProviderId, model: string): string {
  return `${provider}:${model}`;
}

export function parseAlias(alias: string): { provider: ProviderId; model: string } {
  const idx = alias.indexOf(":");
  if (idx <= 0) {
    throw new Error(`Invalid model alias "${alias}", expected "<provider>:<model>"`);
  }
  return { provider: alias.slice(0, idx) as ProviderId, model: alias.slice(idx + 1) };
}

/** Resolve provider credentials/config from environment. */
export function resolveProviderConfig(
  provider: ProviderId,
  env: EnvLike = process.env,
): ProviderConfig {
  const meta = PROVIDER_ENV[provider];
  return {
    provider,
    apiKey: env[meta.apiKey],
    baseUrl: env[meta.baseUrl] ?? meta.defaultBaseUrl,
  };
}

export function isProviderEnabled(provider: ProviderId, env: EnvLike = process.env): boolean {
  if (provider === "cursor") {
    // cursor traffic goes through cursor-cli; enabled when a binary is configured.
    return Boolean(env.FDE_CLI_CURSOR_BIN);
  }
  return Boolean(env[PROVIDER_ENV[provider].apiKey]);
}

/** List the full catalog with enablement flags - drives the web model selector. */
export function listModels(env: EnvLike = process.env): ModelDescriptor[] {
  return CATALOG.map((entry) => ({
    alias: aliasOf(entry.provider, entry.model),
    provider: entry.provider,
    model: entry.model,
    label: entry.label,
    transport: entry.provider === "cursor" ? "cli" : "api",
    enabled: isProviderEnabled(entry.provider, env),
    capabilities: entry.capabilities,
  }));
}

export function defaultModelAlias(env: EnvLike = process.env): string {
  return env.FDE_DEFAULT_MODEL ?? "glm:glm-4.6";
}
