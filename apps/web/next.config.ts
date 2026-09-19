import type { NextConfig } from "next";

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
