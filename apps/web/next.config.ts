import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

/**
 * 本仓库把配置放在**仓库根**的 .env（README / runbook 都这么写），而 Next 只加载它自己
 * 项目目录（apps/web/）下的 .env* —— 于是服务端一直读不到 GLM key、bot token 等。
 *
 * 这里直接读根 .env 注入 process.env。不用 @next/env 的 loadEnvConfig：Next 在求值
 * next.config 之前已经自己加载过一次并缓存，此时再调用会命中缓存直接返回、等于没加载。
 * 不覆盖已存在的值，所以 shell 里 export 的、以及 apps/web/.env 仍然优先。
 */
function loadRepoEnv(): void {
  const envPath = path.resolve(process.cwd(), "../..", ".env");
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, "utf8").split("\n")) {
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
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
loadRepoEnv();

const nextConfig: NextConfig = {
  // workspace packages ship raw TS - let Next transpile them
  transpilePackages: [
    "@fde/shared",
    "@fde/model-gateway",
    "@fde/agent-runtime",
    "@fde/data",
    "@fde/bot-core",
  ],
  // PGlite loads WASM/tarball assets from disk; keep it (and its extensions) out of the bundler
  serverExternalPackages: ["@electric-sql/pglite", "@electric-sql/pglite-pgvector"],
  webpack: (config, { isServer }) => {
    // workspace packages use Node-ESM style ".js" specifiers that point to ".ts" sources
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    if (isServer) {
      // PGlite must load its WASM/tarball assets from disk via real fs paths;
      // force runtime require() so webpack never touches its assets.
      config.externals.push({
        "@electric-sql/pglite": "commonjs @electric-sql/pglite",
        "@electric-sql/pglite-pgvector": "commonjs @electric-sql/pglite-pgvector",
      });
    }
    return config;
  },
};

export default nextConfig;
