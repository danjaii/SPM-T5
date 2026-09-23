import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // tests/e2e is Playwright's (`npm run test:e2e`), not vitest's.
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
  },
});
