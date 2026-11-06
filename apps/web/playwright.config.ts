import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { SERVICES, SERVICE_URL, WEB_URL } from "./tests/e2e/fixtures/env";

// The services read the root .env (Supabase keys, WEB_ORIGIN). Loading it here also hands SUPABASE_URL and
// SUPABASE_SECRET_KEY to the test workers, which arrange data through the service-role REST API. In CI the workflow
// writes the same file. An exported variable wins over the file.
try {
  process.loadEnvFile(path.resolve(__dirname, "../../.env"));
} catch {
  /* no root .env: rely on the environment */
}

const CI = !!process.env.CI;
// BUILT: run the bundled services and the production build of the web app (`next start`), as CI does, instead of tsx and `next dev`.
// Locally that needs `pnpm run e2e:build` first (it bakes in the E2E service ports) and replaces apps/web/.next, so stop your own
// `next dev` first. A dev server compiles each page on its first visit and can stall under parallel workers; a build does not.
const BUILT = CI || !!process.env.E2E_BUILT;

// Services run from source (tsx) locally and from the esbuild bundle in CI (`pnpm run build:all` first). `node --import tsx`
// and `node .../next` are called directly: a package-manager or .cmd wrapper made Playwright wait minutes for shutdown.
const serviceCommand = BUILT
  ? "node --env-file=../../.env dist/index.js"
  : "node --import tsx --env-file=../../.env src/server.ts";

const serviceServers = SERVICES.map((s) => ({
  command: serviceCommand,
  cwd: path.resolve(__dirname, "../../services", s.dir),
  url: `http://localhost:${s.port}/health`,
  env: { PORT: String(s.port) },
  // Only ever reuse a server that is ours: 4101-4105 locally, never the developer's own 4001-4005.
  reuseExistingServer: !CI,
  timeout: 60_000,
}));

// NEXT_PUBLIC_* is read in the browser and is fixed when the page is compiled (`next dev`) or built (`next build` in CI),
// so the web is started with the same ports as the services above.
const webEnv = Object.fromEntries(
  SERVICES.flatMap((s) => {
    const name = `${s.key.toUpperCase()}_SERVICE_URL`;
    return [[name, SERVICE_URL[s.key]], [`NEXT_PUBLIC_${name}`, SERVICE_URL[s.key]]];
  }),
);

export default defineConfig({
  testDir: "./tests/e2e",
  // written into results.json, so the generated documents say how the run was made (scripts/e2e reads it)
  metadata: { mode: CI ? "ci" : BUILT ? "local-built" : "local-dev" },
  fullyParallel: true,
  forbidOnly: CI,
  // One retry in CI so a flaky test shows up as "flaky" in results.json instead of passing silently or failing the run.
  retries: BUILT ? 1 : 0,
  // locally one `next dev` process compiles pages for every worker, so more workers mostly make each test slower
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : CI ? 2 : 3,
  // a spec that passes alone in ~30 s can take twice that when four workers make `next dev` compile pages at once
  timeout: BUILT ? 90_000 : 180_000,
  // `next dev` compiles each page on first use, which is slow; the production build in CI is not.
  expect: { timeout: BUILT ? 15_000 : 40_000 },
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ["json", { outputFile: "test-results/results.json" }],
  ],
  use: {
    baseURL: WEB_URL,
    // without these a missing element waits for the whole test timeout; `next dev` is slow on a first visit, hence the generous values
    actionTimeout: BUILT ? 20_000 : 40_000,
    navigationTimeout: 60_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: "setup/auth.setup.ts" },
    {
      name: "chromium",
      // smoke.spec.ts and every spec under specs/. Old specs not yet folded into the catalogue are not matched.
      testMatch: ["smoke.spec.ts", "specs/**/*.spec.ts"],
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
  webServer: [
    ...serviceServers,
    {
      command: BUILT ? "node ./node_modules/next/dist/bin/next start -p 3000" : "node ./node_modules/next/dist/bin/next dev -p 3000",
      cwd: __dirname,
      url: WEB_URL,
      env: webEnv,
      // Port 3000 is where a developer's own `next dev` usually runs, with other service ports baked in: failing loudly
      // beats testing against the wrong stack. Set E2E_REUSE_WEB=1 to reuse a web server you started yourself.
      reuseExistingServer: !!process.env.E2E_REUSE_WEB,
      timeout: 180_000,
    },
  ],
});
