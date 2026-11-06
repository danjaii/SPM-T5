// SCRUM-191 — Generated E2E documents. Run: node --test "scripts/e2e/*.test.mjs"
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acState, acsOfRef, buildMetrics, buildTraceability, caseState, mergeReviewLog, outcomeOf, parseDefects, parseRef,
  NOT_BUILT, manualProblems, readReport, renderMetrics, renderTestCases, renderTraceability, testCaseRows, toCsv, updateExecutionLog,
} from "./lib.mjs";

const spec = (title, tests) => ({ title, file: "x.spec.ts", tests });
const test1 = (projectName, status, expectedStatus = "passed", results = [{ status: "passed", duration: 5 }]) => ({ projectName, status, expectedStatus, results });

describe("SCRUM-191/AC3 references the catalogue cites", () => {
  it("reads a scenario, an AC in either spelling, a whole story and the to-confirm mark", () => {
    assert.deepEqual(parseRef("103-S1"), { story: 103, ac: null, scenario: "103-S1", confirm: false });
    assert.equal(parseRef("SCRUM-99/AC7").ac, 7);
    assert.equal(parseRef("SCRUM-77-AC7").ac, 7);
    assert.deepEqual(parseRef("SCRUM-24?"), { story: 24, ac: null, scenario: null, confirm: true });
  });

  it("refuses a reference it cannot read instead of dropping it", () => {
    assert.throws(() => parseRef("story 5"), /cannot read/);
  });

  it("maps a scenario to the ACs its spec table gives, and keeps a story-level reference as ac null", () => {
    assert.deepEqual(acsOfRef("98-S1", { "98-S1": [1, 2] }), [{ story: 98, ac: 1 }, { story: 98, ac: 2 }]);
    assert.deepEqual(acsOfRef("98-S9", {}), [{ story: 98, ac: null }]);
    assert.deepEqual(acsOfRef("SCRUM-65", {}), [{ story: 65, ac: null }]);
  });
});

describe("SCRUM-191/AC5 results are read, not typed", () => {
  it("names the outcome of each kind of Playwright test", () => {
    assert.equal(outcomeOf({ status: "expected", expectedStatus: "passed" }), "passed");
    assert.equal(outcomeOf({ status: "expected", expectedStatus: "failed" }), "expected-fail");
    assert.equal(outcomeOf({ status: "unexpected", expectedStatus: "passed" }), "failed");
    assert.equal(outcomeOf({ status: "unexpected", expectedStatus: "failed" }), "failed");
    assert.equal(outcomeOf({ status: "flaky", expectedStatus: "passed" }), "flaky");
    assert.equal(outcomeOf({ status: "skipped", expectedStatus: "skipped" }), "skipped");
  });

  it("counts tests across nested suites, ignores the setup project and takes the ID from the title", () => {
    const report = readReport({
      stats: { startTime: "2026-11-06T01:00:00.000Z", duration: 125000 },
      suites: [
        { specs: [spec("authenticate as every role", [test1("setup", "expected")])] },
        { suites: [{ specs: [
          spec("E2E-ACL-01 each role @P0", [test1("chromium", "expected")]),
          spec("E2E-ACL-05 unassigned @P1", [test1("chromium", "expected", "failed")]),
          spec("smoke page loads", [test1("chromium", "flaky", "passed", [{ status: "failed", duration: 1 }, { status: "passed", duration: 2 }])]),
        ] }] },
      ],
    });
    assert.equal(report.totals.tests, 3);
    assert.equal(report.totals.passed, 1);
    assert.equal(report.totals["expected-fail"], 1);
    assert.equal(report.totals.flaky, 1);
    assert.equal(report.durationMs, 125000);
    assert.equal(report.mode, null, "an older results file has no mode");
    assert.equal(readReport({ config: { metadata: { mode: "local-built" } }, suites: [] }).mode, "local-built");
    assert.equal(report.byId.get("E2E-ACL-01"), "passed");
    assert.equal(report.byId.get("E2E-ACL-05"), "expected-fail");
    assert.equal(report.byId.has("smoke page loads"), false);
    assert.equal(report.tests.find((t) => t.title.startsWith("smoke")).retries, 1);
  });

  it("gives a case its worst outcome when it has several tests", () => {
    const report = readReport({ suites: [{ specs: [
      spec("E2E-CHG-01 a", [test1("chromium", "expected"), test1("chromium", "unexpected")]),
    ] }] });
    assert.equal(report.byId.get("E2E-CHG-01"), "failed");
  });

  it("says no-spec when a case has no spec file, and not-run when its spec has no result", () => {
    const files = new Map([["E2E-A-01", "a.ts"]]);
    assert.equal(caseState("E2E-A-02", files, new Map()), "no-spec");
    assert.equal(caseState("E2E-A-01", files, new Map()), "not-run");
    assert.equal(caseState("E2E-A-01", files, null), "not-run");
    assert.equal(caseState("E2E-A-01", files, new Map([["E2E-A-01", "passed"]])), "passed");
  });

  it("states an AC from its cases: a pass counts unless another case failed", () => {
    assert.equal(acState([]), "not-covered");
    assert.equal(acState(["passed", "expected-fail"]), "passed");
    assert.equal(acState(["passed", "failed"]), "failed");
    assert.equal(acState(["expected-fail"]), "expected-fail");
    assert.equal(acState(["no-spec", "no-spec"]), "no-spec");
    assert.equal(acState(["no-spec", "not-run"]), "not-run");
  });
});

describe("SCRUM-191/AC5 the traceability matrix lists what has no E2E case", () => {
  const catalogue = [
    { id: "E2E-X-01", refs: ["10-S1", "SCRUM-10/AC3"], priority: "P0", type: "normal", features: [1], changes: [], scenario: "s", title: "t" },
    { id: "E2E-X-02", refs: ["SCRUM-30?"], priority: "P1", type: "failure", features: [2], changes: ["C1"], scenario: "s", title: "t" },
  ];
  const specs = {
    stories: { 10: { title: "Ten", file: "ten.md", acs: { 1: "one", 2: "two", 3: "three", 4: "Dropped: four" } }, 20: { title: "Twenty", file: "t.md", acs: { 1: "x", 2: "y" } } },
    scenarios: { "10-S1": [1] },
  };
  const files = new Map([["E2E-X-01", "specs/x/E2E-X-01.spec.ts"]]);
  const tr = buildTraceability({ catalogue, specs, specFiles: files, byId: new Map([["E2E-X-01", "passed"]]) });

  it("lists every AC of a cited story, marking the uncited ones Not covered and a dropped one as dropped", () => {
    const ten = tr.stories.find((s) => s.story === 10);
    assert.deepEqual(ten.acs.map((a) => [a.ac, a.state]), [[1, "passed"], [2, "not-covered"], [3, "passed"], [4, "dropped"]]);
  });

  it("keeps a story with no spec at story level, to confirm, without inventing ACs", () => {
    const thirty = tr.stories.find((s) => s.story === 30);
    assert.deepEqual(thirty.acs, []);
    assert.equal(thirty.storyLevel.confirm, true);
  });

  it("counts the ACs it cites and the ones in specs no case cites", () => {
    assert.equal(tr.citedStories, 2);
    assert.equal(tr.acsInCitedStories, 3);
    assert.equal(tr.acsReferenced, 2);
    assert.equal(tr.acsPassed, 2);
    assert.equal(tr.totalSpecAcs - tr.citedSpecAcs, 2);
  });

  const meta = { commit: "abc1234", date: "2026-11-06" };
  const gap = [{ change: "C9", stories: ["SCRUM-900"], what: "A thing not built", defect: "D-009" }];

  it("writes a requirement that is not built into the matrix as not covered", () => {
    const md = renderTraceability(tr, { specFiles: files, meta, notBuilt: gap });
    assert.match(md, /\| C9 \| SCRUM-900 \| A thing not built \| D-009 \| Not covered \|/);
    assert.match(md, /\| AC2 \| two \| - \| Not covered \|/);
  });

  it("says nothing is left out when nothing is unbuilt, which is the case today (hold expiry is built)", () => {
    assert.deepEqual(NOT_BUILT, []);
    const md = renderTraceability(tr, { specFiles: files, meta });
    assert.match(md, /Nothing the customer asked for is left out: every Week 7 change is built and has an E2E case\./);
    assert.doesNotMatch(md, /\| C4 \|/);
  });
});

describe("SCRUM-191/AC5 metrics", () => {
  const catalogue = [
    { id: "E2E-A-01", refs: ["SCRUM-1"], priority: "P0", type: "normal", features: [1, 2], changes: ["C1"] },
    { id: "E2E-A-02", refs: ["SCRUM-1"], priority: "P1", type: "failure", features: [2], changes: [] },
  ];
  const files = new Map([["E2E-A-01", "a.ts"], ["E2E-A-02", "b.ts"]]);
  const report = readReport({ stats: { duration: 61000 }, suites: [{ specs: [
    spec("E2E-A-01 x", [test1("chromium", "expected")]), spec("E2E-A-02 y", [test1("chromium", "unexpected")]),
  ] }] });
  const defects = parseDefects("| D-001 | none | SCRUM-97 | text | High | Open: reported |\n| D-002 | E2E-A-02 | SCRUM-98 | text | Low | Closed |");
  const m = buildMetrics({ catalogue, specFiles: files, report, tr: null, defects, meta: { commit: "abc", timestamp: "2026-11-06T00:00:00Z" } });

  it("counts passing cases per feature and per change, and says which have none", () => {
    assert.deepEqual(m.features.filter((f) => f.passed).map((f) => f.n), [1, 2]);
    assert.equal(m.features.filter((f) => f.passed).length, 2);
    assert.deepEqual(m.changes.filter((c) => c.passed).map((c) => c.key), ["C1"]);
    assert.equal(m.changes.find((c) => c.key === "C4").inCatalogue, false);
  });

  it("counts open defects from defects.md and not the closed ones", () => {
    assert.equal(m.defectsOpen.length, 1);
    assert.equal(m.defectsOpen[0].id, "D-001");
    assert.equal(m.defectsAll, 2);
  });

  it("writes the run totals, the duration and the not-built change", () => {
    const md = renderMetrics(m);
    assert.match(md, /\| 2 \| 1 \| 1 \| 0 \| 0 \| 0 \| 1 min 1 s \|/);
    assert.match(md, /Change C4 Tentative hold expiry: no case(\r?\n|$)/);
    const withGap = renderMetrics(buildMetrics({ catalogue, specFiles: files, report, tr: null, defects, meta: { commit: "abc", timestamp: "t" }, notBuilt: [{ change: "C4", stories: [], what: "x", defect: "D-077" }] }));
    assert.match(withGap, /Change C4 Tentative hold expiry: no case \(not built, defect D-077\)/);
    assert.match(md, /## Defects \(1 open of 2\)/);
  });

  it("still writes the catalogue counts when there is no run", () => {
    const md = renderMetrics(buildMetrics({ catalogue, specFiles: files, report: null, tr: null, defects, meta: { commit: "abc", timestamp: "t" } }));
    assert.match(md, /No results.json was found/);
  });
});

describe("SCRUM-191/AC3 test cases", () => {
  const catalogue = [
    { id: "E2E-A-01", title: "first", refs: ["SCRUM-1", "2-S1"], scenario: "s one", priority: "P0", type: "normal", features: [1], changes: ["C1"] },
    { id: "E2E-A-02", title: "second", refs: [], scenario: "s two", priority: "P2", type: "boundary", features: [], changes: [] },
  ];
  const script = { setups: ["S1"], preconditions: "pre", data: "data", steps: ["one", "two"], expected: ["ok"] };
  const setups = [{ id: "S1", title: "Do the first thing", steps: ["a", "b"] }];
  const content = { setups, accounts: [["Jason", "j@x", "Event Organiser"]], password: "pw", baseUrl: "http://localhost:3000" };

  it("finds every way a script can be missing or wrong, and nothing when they are all complete", () => {
    assert.deepEqual(manualProblems(catalogue, { "E2E-A-01": script, "E2E-A-02": script }, setups), []);
    const problems = manualProblems(
      catalogue,
      { "E2E-A-01": { ...script, steps: [], expected: [], data: "", preconditions: "", setups: ["S9"] }, "E2E-Z-01": script },
      setups,
    );
    assert.deepEqual(problems, [
      "E2E-A-01 has no preconditions", "E2E-A-01 has no test data", "E2E-A-01 has no steps", "E2E-A-01 has no expected results",
      "E2E-A-01 names an unknown set-up S9", "E2E-A-02 has no manual script", "a manual script exists for E2E-Z-01, which is not in the catalogue",
    ]);
  });

  it("writes one row per case: the script's numbered steps and results, its set-ups, and the spec path or 'not written yet'", () => {
    const rows = testCaseRows(catalogue, new Map([["E2E-A-01", "a.spec.ts"]]), { "E2E-A-01": script, "E2E-A-02": { ...script, setups: [] } });
    assert.equal(rows[0][1], "SCRUM-1, 2-S1");
    assert.equal(rows[0][3], "Set-ups: S1. pre");
    assert.equal(rows[0][4], "1. one\n2. two");
    assert.equal(rows[0][6], "1. ok");
    assert.equal(rows[0].at(-1), "a.spec.ts");
    assert.equal(rows[1][3], "pre", "no set-ups, no prefix");
    assert.equal(rows[1].at(-1), "not written yet");
  });

  it("prints the accounts, each set-up once, an index, and every case as its own section", () => {
    const md = renderTestCases(catalogue, new Map([["E2E-A-01", "a.spec.ts"]]), { "E2E-A-01": script, "E2E-A-02": { ...script, setups: [] } }, content, { commit: "abc1234", date: "2026-11-06" });
    assert.match(md, /## Accounts \(password for all: `pw`\)/);
    assert.match(md, /\| Jason \| j@x \| Event Organiser \|/);
    assert.match(md, /### S1: Do the first thing\n\n1\. a\n2\. b/);
    assert.match(md, /\| \[E2E-A-01\]\(#e2e-a-01\) \| s one \| P0 \| normal \| a\.spec\.ts \|/);
    assert.match(md, /### E2E-A-01\n\n\*\*first\*\*[\s\S]*\*\*Steps\*\*\n\n1\. one\n2\. two\n\n\*\*Expected results\*\*\n\n1\. ok/);
    assert.match(md, /- \*\*Set-ups:\*\* S1/);
    assert.match(md, /### E2E-A-02[\s\S]*- \*\*Set-ups:\*\* none/);
    assert.match(md, /- \*\*Priority \/ type:\*\* P0, normal; Week 7 C1; features 1/);
  });

  it("quotes CSV cells that hold commas, quotes or line breaks", () => {
    assert.equal(toCsv(["a", "b"], [["x,y", 'say "hi"\nnow']]), 'a,b\r\n"x,y","say ""hi""\nnow"\r\n');
  });
});

describe("SCRUM-191/AC7 the review log is never filled in for a person", () => {
  const existing = [
    "# Log", "", "intro", "",
    "| Test ID | Drafted by | Reviewer | Date | AI self-checks | Human checks (H1-H4) | Changes made in review |",
    "| ----- | ----- | ----- | ----- | ----- | ----- | ----- |",
    "| E2E-A-01 | AI (Claude Code) | Sam | 2026-11-05 | checked | H1 H2 | edited |",
    "",
    "Notes below the table.",
  ].join("\n");

  it("keeps an existing row exactly, even one a person filled in, and adds the missing IDs with blank reviewer and date", () => {
    const { text, added } = mergeReviewLog(existing, [{ id: "E2E-A-01" }, { id: "E2E-A-02" }]);
    assert.equal(added, 1);
    assert.match(text, /\| E2E-A-01 \| AI \(Claude Code\) \| Sam \| 2026-11-05 \| checked \| H1 H2 \| edited \|/);
    assert.match(text, /\| E2E-A-02 \| AI \(Claude Code\) \| \| \| Row generated for a new case: no self-check recorded yet\. \| \| \|/);
    assert.ok(text.indexOf("E2E-A-02") < text.indexOf("Notes below the table."));
  });

  it("is idempotent: a second merge adds nothing", () => {
    const once = mergeReviewLog(existing, [{ id: "E2E-A-01" }, { id: "E2E-A-02" }]).text;
    assert.equal(mergeReviewLog(once, [{ id: "E2E-A-01" }, { id: "E2E-A-02" }]).added, 0);
  });

  it("refuses a file with no review table rather than rewriting it", () => {
    assert.throws(() => mergeReviewLog("nothing here", [{ id: "E2E-A-01" }]), /no table/);
  });
});

describe("SCRUM-191/AC5 execution log", () => {
  const report = readReport({ suites: [{ specs: [spec("E2E-A-01 x", [test1("chromium", "expected")]), spec("E2E-A-02 y", [test1("chromium", "expected", "failed")])] }] });
  const run = { runId: "ci-77", date: "2026-11-06", commit: "abc1234", environment: "CI", evidence: "https://example/run/77", report, catalogue: [{ id: "E2E-A-01" }, { id: "E2E-A-02" }], defects: [{ id: "D-002", testId: "E2E-A-02" }] };

  it("adds an automated row per test with its result and defect, and one blank manual row per case", () => {
    const text = updateExecutionLog(null, run);
    assert.match(text, /\| ci-77 \| 2026-11-06 \| Playwright \(automated\) \| abc1234 \| CI \| E2E-A-01 \| Passed \| https:\/\/example\/run\/77 \| {2}\|/);
    assert.match(text, /\| E2E-A-02 \| Expected fail \| https:\/\/example\/run\/77 \| D-002 \|/);
    assert.match(text, /\| manual \| {2}\| {2}\| {2}\| {2}\| E2E-A-01 \| {2}\| {2}\| {2}\|/);
  });

  it("does not add a run twice or a second manual row, and keeps earlier rows", () => {
    const first = updateExecutionLog(null, run);
    const again = updateExecutionLog(first, run);
    assert.equal(again, first);
    const next = updateExecutionLog(first, { ...run, runId: "ci-78" });
    assert.equal((next.match(/\| ci-77 \|/g) ?? []).length, 2);
    assert.equal((next.match(/\| ci-78 \|/g) ?? []).length, 2);
    assert.equal((next.match(/\| manual \|/g) ?? []).length, 2);
  });
});
