/** Model provider / traffic-switching domain models. */

export type ProviderId = "glm" | "deepseek" | "openai" | "claude" | "cursor";

/** How the traffic is carried: direct vendor API, or a local coding CLI. */
export type ProviderTransport = "api" | "cli";

/** CLI auth mode: reuse the CLI's logged-in subscription, or inject an API key. */
export type CliAuthMode = "subscription" | "apikey";

export interface ModelDescriptor {
  /** Alias used across the system, format "<provider>:<model>", e.g. "glm:glm-4.6". */
  alias: string;
  provider: ProviderId;
  model: string;
  label: string;
  transport: ProviderTransport;
  /** Whether this alias is currently usable (credentials present). */
  enabled: boolean;
  capabilities?: {
    streaming?: boolean;
    tools?: boolean;
    reasoning?: boolean;
  };
}

export interface ProviderConfig {
  provider: ProviderId;
  apiKey?: string;
  baseUrl?: string;
  /** For transport=cli: which binary to spawn and how to authenticate it. */
  cli?: {
    bin: string;
    auth: CliAuthMode;
  };
}
