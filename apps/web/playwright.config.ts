import { defineConfig } from "@playwright/test";

/**
 * UI 交互冒烟（ai-coding skill：UI 改动必须实际测试交互）。
 * 预期被测服务器已在运行（pnpm dev / pnpm start / rebuild --restart）。
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: process.env.FDE_E2E_BASE_URL ?? "http://localhost:3000",
    headless: true,
  },
});
