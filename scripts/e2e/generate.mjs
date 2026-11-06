// SCRUM-191: writes the generated E2E documents in docs/testing/e2e from Playwright's results.json, the catalogue and the specs.
//
//   pnpm run e2e:docs      02-test-cases, 03-traceability-matrix, 04-execution-log, 05-review-log (new IDs only), metrics.md
//   pnpm run e2e:metrics   metrics.md only, and the same Markdown on stdout (CI appends it to the job summary)
//
// Both read apps/web/test-results/results.json (override with --results <path>). Without it the catalogue counts are still written
// and the run section says there is no run. The rules are in lib.mjs, tested by lib.test.mjs. The catalogue is a TypeScript file
// with no imports, which Node 22.18+ loads directly.
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { parseSpec } from "../traceability/lib.mjs";
import {
  buildMetrics, buildTraceability, mergeReviewLog, parseDefects, readReport, renderMetrics, renderTestCases,
  renderTraceability, stepsOf, testCaseRows, toCsv, traceabilityCsv, updateExecutionLog,
} from "./lib.mjs";

const root = join(import.meta.dirname, "..", "..");
const docs = join(root, "docs", "testing", "e2e");
const e2eDir = join(root, "apps", "web", "tests", "e2e");

const mode = process.argv[2];
if (mode !== "docs" && mode !== "metrics") {
  console.error("Usage: node scripts/e2e/generate.mjs docs|metrics [--results <results.json>]");
  process.exit(2);
}
const flag = (name) => process.argv.indexOf(name) > -1 ? process.argv[process.argv.indexOf(name) + 1] : null;
const resultsPath = flag("--results") ?? join(root, "apps", "web", "test-results", "results.json");

const { CATALOGUE: catalogue } = await import(pathToFileURL(join(e2eDir, "catalogue.ts")).href);

// the spec file of each case: specs/<area>/E2E-<AREA>-nn-<slug>.spec.ts
const specFiles = new Map();
const stepsById = new Map();
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
for (const file of walk(join(e2eDir, "specs")).filter((f) => f.endsWith(".spec.ts"))) {
  const id = /^(E2E-[A-Z]+-\d+)-/.exec(basename(file))?.[1];
  if (!id) continue;
  specFiles.set(id, relative(root, file).replaceAll("\\", "/"));
  stepsById.set(id, stepsOf(readFileSync(file, "utf8")));
}
const unknown = [...specFiles.keys()].filter((id) => !catalogue.some((c) => c.id === id));
if (unknown.length) {
  console.error(`Spec files for IDs that are not in the catalogue: ${unknown.join(", ")}`);
  process.exit(1);
}

const specs = { stories: {}, scenarios: {} };
const specsDir = join(root, "docs", "specs");
for (const name of readdirSync(specsDir).filter((f) => f.endsWith(".md")).sort()) {
  const parsed = parseSpec(readFileSync(join(specsDir, name), "utf8"), name);
  for (const [n, story] of Object.entries(parsed.stories)) {
    specs.stories[n] = specs.stories[n] ? { ...specs.stories[n], acs: { ...specs.stories[n].acs, ...story.acs } } : story;
  }
  Object.assign(specs.scenarios, parsed.scenarios);
}

const report = existsSync(resultsPath) ? readReport(JSON.parse(readFileSync(resultsPath, "utf8"))) : null;
if (!report) console.warn(`No ${relative(root, resultsPath)}: writing the catalogue counts without a run.`);
const defects = parseDefects(readFileSync(join(docs, "defects.md"), "utf8"));

const sha = process.env.GITHUB_SHA?.slice(0, 7) ?? execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim();
const now = new Date();
const when = report?.startTime ? new Date(report.startTime) : now;
const ci = Boolean(process.env.CI);
const meta = {
  commit: sha,
  date: when.toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" }),
  timestamp: when.toISOString(),
  environment: ci ? "GitHub Actions, ubuntu, Chromium, production build" : `Local (${process.platform}), Chromium, next dev`,
};

const tr = buildTraceability({ catalogue, specs, specFiles, byId: report?.byId ?? null });
const metrics = renderMetrics(buildMetrics({ catalogue, specFiles, report, tr, defects, meta }));
const write = (name, text) => writeFileSync(join(docs, name), text);

write("metrics.md", metrics);
if (mode === "metrics") {
  process.stdout.write(metrics);
  process.exit(0);
}

write("02-test-cases.md", renderTestCases(catalogue, specFiles, stepsById, meta));
write("02-test-cases.csv", toCsv(
  ["Test ID", "Story / AC refs", "Scenario", "Preconditions", "Steps", "Test data", "Expected results", "Priority", "Type", "Features", "Week 7 changes", "Automated spec"],
  testCaseRows(catalogue, specFiles, stepsById)));
write("03-traceability-matrix.md", renderTraceability(tr, { specFiles, meta }));
write("03-traceability-matrix.csv", traceabilityCsv(tr, specFiles));

const logPath = join(docs, "04-execution-log.md");
const runId = ci ? `ci-${process.env.GITHUB_RUN_ID}` : `local-${meta.timestamp.slice(0, 16).replace(/[-:]/g, "").replace("T", "-")}`;
write("04-execution-log.md", updateExecutionLog(existsSync(logPath) ? readFileSync(logPath, "utf8") : null, {
  runId, date: meta.date, commit: sha, environment: meta.environment, report, catalogue, defects,
  evidence: ci ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : "Local run: apps/web/playwright-report",
}));

const reviewPath = join(docs, "05-review-log.md");
// a row says "drafted by AI", so only a case whose spec exists gets one
const review = mergeReviewLog(readFileSync(reviewPath, "utf8"), catalogue.filter((c) => specFiles.has(c.id)));
write("05-review-log.md", review.text);

console.log(`Wrote docs/testing/e2e: ${catalogue.length} cases (${specFiles.size} with a spec), ${review.added} new review-log rows, run ${report ? runId : "none"}.`);
