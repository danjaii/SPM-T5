// SCRUM-175: writes docs/traceability.md, the matrix from user stories and ACs to the tests that check them.
// Usage: pnpm run traceability   (local Supabase running, so the database tests run instead of being skipped)
//
// It runs the whole test suite itself and writes the matrix only when every test passed and none was skipped, so the
// matrix never claims a test passes when it does not (SCRUM-175/AC4). The rules are in lib.mjs, tested by lib.test.mjs.
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { buildMatrix, explainRun, lineOf, parseSpec, renderMarkdown } from "./lib.mjs";

const root = join(import.meta.dirname, "..", "..");
const specsDir = join(root, "docs", "specs");
const out = join(root, "docs", "traceability.md");

// the database tests read SUPABASE_URL and its keys; without them they skip
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
const dbConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY && process.env.SUPABASE_PUBLISHABLE_KEY);

// 1. Every test, with its result
const report = join(tmpdir(), `traceability-${process.pid}.json`);
// SCRUM-195/AC5: the JSON report drops beforeAll/afterAll errors, so a second reporter saves them
const hookReport = join(tmpdir(), `traceability-${process.pid}-hooks.json`);
const hookReporter = join(import.meta.dirname, "hookErrorsReporter.mjs");
console.log("Running every test (a few minutes)…");
try {
  // SCRUM-195/AC6: this run is far heavier than CI's (every workspace and every database test at once), and vitest's
  // default limits (5 s a test, 10 s a hook) ran out for fast tests that pass on their own, so it gets longer ones
  const limits = "--testTimeout=30000 --hookTimeout=60000";
  execSync(`pnpm vitest run --coverage.enabled=false ${limits} --reporter=json --outputFile="${report}" --reporter="${hookReporter}"`, {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, TRACEABILITY_HOOK_ERRORS: hookReport },
  });
} catch {
  // vitest exits non-zero when a test fails; the report says which, below
}
if (!existsSync(report)) {
  console.error("The test run produced no report, so the matrix was not written.");
  process.exit(1);
}
const results = JSON.parse(readFileSync(report, "utf8"));
const hookErrors = existsSync(hookReport) ? JSON.parse(readFileSync(hookReport, "utf8")) : [];

// SCRUM-195/AC5: say exactly why a run cannot produce the matrix (failed tests, failed setup or cleanup, missing settings)
const toRepo = (path) => relative(root, path).replaceAll("\\", "/");
const verdict = explainRun(results, hookErrors, { dbConfigured, relative: toRepo });
if (!verdict.ok) {
  console.error(`The test run did not pass cleanly, so the matrix was not written:\n${verdict.lines.join("\n")}`);
  // SCRUM-195/AC5: the lines above show each error's first line; the reports keep the full errors and stack traces
  console.error(`Full test report kept at ${report}${existsSync(hookReport) ? ` (setup and cleanup errors: ${hookReport})` : ""}`);
  process.exit(1);
}
rmSync(report);
rmSync(hookReport, { force: true });
const tests = [];
for (const file of results.testResults) {
  for (const t of file.assertionResults) tests.push({ name: [...t.ancestorTitles, t.title].join(" > "), file: toRepo(file.name) });
}

// 2. Each test's line, read once per file
const sources = new Map();
for (const t of tests) {
  if (!sources.has(t.file)) sources.set(t.file, readFileSync(join(root, t.file), "utf8"));
  t.line = lineOf(sources.get(t.file), t.name);
}

// 3. Every spec's stories, ACs and scenarios, merged
const specs = { stories: {}, scenarios: {} };
for (const name of readdirSync(specsDir).filter((f) => f.endsWith(".md")).sort()) {
  const parsed = parseSpec(readFileSync(join(specsDir, name), "utf8"), name);
  for (const [n, story] of Object.entries(parsed.stories)) {
    specs.stories[n] = specs.stories[n] ? { ...specs.stories[n], acs: { ...specs.stories[n].acs, ...story.acs } } : story;
  }
  Object.assign(specs.scenarios, parsed.scenarios);
}

// 4. The matrix
const matrix = buildMatrix(tests, specs);
const meta = {
  date: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" }),
  commit: execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim(),
  passed: tests.length,
};
writeFileSync(out, renderMarkdown(matrix, meta));
console.log(`Wrote docs/traceability.md: ${matrix.stories.length} stories, ${tests.length} tests, ${matrix.untraced} naming no story.`);
