// Mutation testing for the shared business rules (SCRUM-187). Run by hand with `pnpm run test:mutation`; it is not
// part of CI because it runs the tests once per small change it makes. docs/testing/mutation-testing.md explains it.
export default {
  testRunner: "vitest",
  // Named here because pnpm's folder layout stops Stryker finding its plugins on its own.
  plugins: ["@stryker-mutator/vitest-runner"],
  vitest: { configFile: "vitest.stryker.config.mts" },
  mutate: [
    "packages/shared/src/**/*.ts",
    "!packages/shared/src/index.ts", // only re-exports the other files: there are no rules to break
    "!packages/shared/src/supabaseClient.ts", // only creates the database client: there are no rules to break
  ],
  // Stryker works on a temporary copy of the repo, and the unit tests don't need these folders.
  ignorePatterns: [".next", "dist", "docs", "supabase", "scripts", ".github", ".agents"],
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/shared.html" },
  jsonReporter: { fileName: "reports/mutation/shared.json" },
  // No score fails the run, for the same reason CI has no coverage threshold (SCRUM-173).
  thresholds: { high: 80, low: 60, break: null },
  tempDirName: ".stryker-tmp",
};
