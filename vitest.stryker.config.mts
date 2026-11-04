import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const SERVICES = ["auth-service", "event-service", "venue-service", "equipment-service", "notification-service"];

// Stryker changes a temporary copy of the code, but the workspace link still points at the original packages/shared.
// This points the import at the copy, so the services' tests see each change.
const resolve = { alias: { "@spm-t5/shared": fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)) } };

// Used only by stryker.config.mjs (SCRUM-187). The shared rules are also tested through the services' routes, so those
// unit tests count. Left out: integration tests, which need a database, and the web app's page tests, which took longer
// than Stryker's 5-minute limit for its first run with no changes.
export default defineConfig({
  test: {
    projects: [
      { test: { name: "shared", include: ["packages/shared/tests/**/*.test.ts"] } },
      ...SERVICES.map((service) => ({
        extends: `services/${service}/vitest.config.ts`,
        resolve,
        test: { name: service, root: `services/${service}`, include: ["tests/unit/**/*.test.ts"] },
      })),
    ],
  },
});
