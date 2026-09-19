import { MCPServerStdio, MCPServerStreamableHttp } from "@openai/agents";
import { z } from "zod";

/**
 * MCP server manager. Servers are declared via FDE_MCP_SERVERS env as JSON:
 * [
 *   { "name": "kb", "transport": "stdio", "command": "npx", "args": ["-y", "@fde/mcp-kb"] },
 *   { "name": "ticket", "transport": "http", "url": "http://localhost:9000/mcp" }
 * ]
 * Python MCP servers work too - transport is agnostic to implementation language.
 */
const mcpConfigSchema = z.array(
  z.discriminatedUnion("transport", [
    z.object({
      name: z.string(),
      transport: z.literal("stdio"),
      command: z.string(),
      args: z.array(z.string()).default([]),
      env: z.record(z.string(), z.string()).optional(),
    }),
    z.object({
      name: z.string(),
      transport: z.literal("http"),
      url: z.string().url(),
    }),
  ]),
);

export type McpConfig = z.infer<typeof mcpConfigSchema>[number];

type AnyMcpServer = MCPServerStdio | MCPServerStreamableHttp;

export class McpManager {
  private servers: AnyMcpServer[] = [];
  private connected = false;

  constructor(private readonly configs: McpConfig[]) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): McpManager {
    const raw = env.FDE_MCP_SERVERS;
    if (!raw) return new McpManager([]);
    const parsed = mcpConfigSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(`Invalid FDE_MCP_SERVERS: ${parsed.error.message}`);
    }
    return new McpManager(parsed.data);
  }

  async connect(): Promise<AnyMcpServer[]> {
    if (this.connected) return this.servers;
    for (const cfg of this.configs) {
      const server: AnyMcpServer =
        cfg.transport === "stdio"
          ? new MCPServerStdio({
              command: cfg.command,
              args: cfg.args,
              env: cfg.env,
              cacheToolsList: true,
            })
          : new MCPServerStreamableHttp({ url: cfg.url, cacheToolsList: true });
      await server.connect();
      this.servers.push(server);
    }
    this.connected = true;
    return this.servers;
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.servers.map((s) => s.close()));
    this.servers = [];
    this.connected = false;
  }
}
