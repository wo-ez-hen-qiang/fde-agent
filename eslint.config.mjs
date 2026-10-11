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
      // ignoreRestSiblings: 放行 `const { a: _private, ...safe } = obj` 这种 omit 解构
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "no-console": "off",
    },
  },
);
