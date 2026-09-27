import { defineConfig } from "vitest/config";

// `pnpm vitest run` from the repo root discovers every workspace's tests (like `unittest discover`).
// Each folder is its own project: apps/web brings its own vitest.config.ts (jsdom, `@` alias);
// the others use the defaults.
export default defineConfig({
  test: {
    projects: ["apps/web", "services/*", "packages/shared"],
    // Coverage is configured here, not per project: with projects, only the root's setting applies.
    coverage: {
      enabled: true,
      provider: "v8",
      reportsDirectory: "coverage",
      reporter: ["text", "html", "lcov"],
      include: ["apps/web/src/**/*.{ts,tsx}", "services/*/src/**/*.ts", "packages/shared/src/**/*.ts"],
      exclude: ["**/*.d.ts"],
    },
  },
});
