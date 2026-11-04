import { defineConfig } from "vitest/config";

// Used only by stryker.config.mjs (SCRUM-187): the root vitest.config.mts would run every workspace's tests.
export default defineConfig({
  test: {
    include: ["packages/shared/tests/**/*.test.ts"],
  },
});
