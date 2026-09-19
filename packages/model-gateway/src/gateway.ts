import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { ProviderId } from "@fde/shared";
import { parseAlias, resolveProviderConfig, type EnvLike } from "./registry.js";

/**
 * The gateway is the single place that turns a model alias ("glm:glm-4.6")
 * into a concrete AI SDK language model. Everything above (agent runtime,
 * web api, cli, bots) only ever deals with aliases, which is what makes
 * traffic switching a one-line change.
 */
export class ModelGateway {
  constructor(private readonly env: EnvLike = process.env) {}

  /** Resolve an alias to a concrete AI SDK language model. */
  resolve(alias: string): LanguageModelV4 {
    const { provider, model } = parseAlias(alias);
    return this.resolveProvider(provider, model);
  }

  private resolveProvider(provider: ProviderId, model: string): LanguageModelV4 {
    const cfg = resolveProviderConfig(provider, this.env);
    switch (provider) {
      case "glm":
        return createOpenAICompatible({
          name: "glm",
          apiKey: requireKey(cfg.apiKey, provider),
          baseURL: cfg.baseUrl!,
        })(model);
      case "deepseek":
        return createOpenAICompatible({
          name: "deepseek",
          apiKey: requireKey(cfg.apiKey, provider),
          baseURL: cfg.baseUrl!,
        })(model);
      case "openai":
        return createOpenAI({
          apiKey: requireKey(cfg.apiKey, provider),
          baseURL: cfg.baseUrl,
        })(model);
      case "claude":
        return createAnthropic({
          apiKey: requireKey(cfg.apiKey, provider),
          baseURL: cfg.baseUrl,
        })(model);
      case "cursor":
        throw new Error(
          'Provider "cursor" is carried by cursor-cli; use @fde/cli backends instead of the HTTP gateway',
        );
      default: {
        const exhaustive: never = provider;
        throw new Error(`Unknown provider: ${String(exhaustive)}`);
      }
    }
  }
}

function requireKey(key: string | undefined, provider: ProviderId): string {
  if (!key) {
    throw new Error(
      `Provider "${provider}" is not configured: missing API key env var. See .env.example`,
    );
  }
  return key;
}
