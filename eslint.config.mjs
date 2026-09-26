import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// Shared by services/* and packages/shared (ESLint walks up from the workspace to find this).
// apps/web has its own eslint.config.mjs, which takes precedence there.
export default tseslint.config(
  { ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
  },
);
