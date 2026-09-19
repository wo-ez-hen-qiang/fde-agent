/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: {
      path: "(node_modules|\\.next|dist|\\.data|e2e|playwright\\.config)",
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "禁止循环依赖（A2）",
      from: {},
      to: { circular: true },
    },
    {
      name: "packages-must-not-import-apps",
      severity: "error",
      comment: "底层 packages 不得依赖应用层 apps",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "shared-is-leaf",
      severity: "error",
      comment: "shared 不依赖任何内部包",
      from: { path: "^packages/shared/" },
      to: { path: "^packages/(?!shared/)" },
    },
    {
      name: "bot-core-only-shared",
      severity: "error",
      from: { path: "^packages/bot-core/" },
      to: { path: "^packages/(?!shared/|bot-core/)" },
    },
    {
      name: "model-gateway-only-shared",
      severity: "error",
      from: { path: "^packages/model-gateway/" },
      to: { path: "^packages/(?!shared/|model-gateway/)" },
    },
    {
      name: "data-only-shared",
      severity: "error",
      from: { path: "^packages/data/" },
      to: { path: "^packages/(?!shared/|data/)" },
    },
  ],
};
