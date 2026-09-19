import tseslint from "typescript-eslint";

/** fde-agent monorepo lint config (flat config, eslint 9). */
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.data/**",
      "**/next-env.d.ts",
      "docs/**",
      "deploy/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": "off",
    },
  },
);
