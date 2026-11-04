// SCRUM-175: writes docs/traceability.md, the matrix from user stories and ACs to the tests that check them.
// Usage: pnpm run traceability   (local Supabase running, so the database tests run instead of being skipped)
//
// It runs the whole test suite itself and writes the matrix only when every test passed and none was skipped, so the
// matrix never claims a test passes when it does not (SCRUM-175/AC4). The rules are in lib.mjs, tested by lib.test.mjs.
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { buildMatrix, lineOf, parseSpec, renderMarkdown } from "./lib.mjs";

const root = join(import.meta.dirname, "..", "..");
const specsDir = join(root, "docs", "specs");
const out = join(root, "docs", "traceability.md");

// the database tests read SUPABASE_URL and its keys; without them they skip
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));

// 1. Every test, with its result
const report = join(tmpdir(), `traceability-${process.pid}.json`);
console.log("Running every test (a few minutes)…");
try {
  execSync(`pnpm vitest run --coverage.enabled=false --reporter=json --outputFile="${report}"`, { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
} catch {
  // vitest exits non-zero when a test fails; the report says which, below
}
if (!existsSync(report)) {
  console.error("The test run produced no report, so the matrix was not written.");
  process.exit(1);
}
const results = JSON.parse(readFileSync(report, "utf8"));
rmSync(report);

const tests = [];
const notPassed = [];
for (const file of results.testResults) {
  const path = relative(root, file.name).replaceAll("\\", "/");
  for (const t of file.assertionResults) {
    const name = [...t.ancestorTitles, t.title].join(" > ");
    if (t.status !== "passed") notPassed.push(`${t.status}: ${path} > ${name}`);
    tests.push({ name, file: path });
  }
}
if (notPassed.length > 0) {
  console.error(`${notPassed.length} tests did not pass, so the matrix was not written:\n${notPassed.slice(0, 20).join("\n")}`);
  console.error("Skipped database tests mean local Supabase is not running or .env does not point at it.");
  process.exit(1);
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
