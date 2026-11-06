// SCRUM-191: builds the five services and the web app for a local E2E run in built mode (E2E_BUILT=1), the way CI runs them.
//   pnpm run e2e:build        then        E2E_BUILT=1 pnpm run test:e2e
//
// The web app's NEXT_PUBLIC_* service addresses are fixed when it is built, and a local E2E run starts the services on 4101-4105 (so a
// developer's own servers on 4001-4005 are left alone), so those addresses are set here, the same way playwright.config.ts sets them
// for `next dev`. This replaces apps/web/.next: stop your own `next dev` first.
import { spawnSync } from "node:child_process";

const base = Number(process.env.E2E_SERVICE_PORT_BASE ?? 4101);
const services = ["AUTH", "EVENT", "VENUE", "EQUIPMENT", "NOTIFICATION"];
const env = { ...process.env };
services.forEach((key, i) => {
  const url = `http://localhost:${base + i}`;
  env[`${key}_SERVICE_URL`] = url;
  env[`NEXT_PUBLIC_${key}_SERVICE_URL`] = url;
});

console.log(`Building with the services on ports ${base} to ${base + services.length - 1} (replaces apps/web/.next)…`);
const run = spawnSync("pnpm", ["run", "build:all"], { stdio: "inherit", env, shell: process.platform === "win32" });
process.exit(run.status ?? 1);
