// SCRUM-191: the rules behind the generated E2E documents, kept free of file and process access so lib.test.mjs can check
// them. generate.mjs feeds them the catalogue (apps/web/tests/e2e/catalogue.ts), Playwright's results.json, the specs in
// docs/specs and the hand-kept defects.md, and writes docs/testing/e2e/*.

export const FEATURES = [
  "Authorisation and authentication", "Event request creation", "Draft event requests", "Event review and approval",
  "Coordinator assignment and reassignment", "Event status state machine", "Event information management",
  "Venue catalogue", "Venue availability calendar", "Venue search and filtering", "Venue suitability checks",
  "Venue booking requests", "Venue booking approval and rejection", "Booking conflict detection",
  "Equipment request management", "Equipment availability checks", "Equipment reservation",
  "Attendee registration", "Event change requests after approval", "Notifications",
];

export const CHANGES = {
  C1: "Setup and turnaround times", C2: "Venue unavailable", C3: "Several bookings per event",
  C4: "Tentative hold expiry", C5: "Event Coordinator Lead", C6: "Safety Officer",
};

/**
 * Requirements the customer asked for that are not built, so no E2E case can exist. Reported, never hidden. Each entry is
 * { change, stories, what, defect }. Empty today: tentative hold expiry (C4), the only one, was built by SCRUM-97 and SCRUM-108 and
 * has E2E-HOLD-01. The reporting below stays, so a gap found later is listed here and shows as Not covered.
 */
export const NOT_BUILT = [];

const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
export const toCsv = (header, rows) => [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

/** A Markdown table cell: pipes escaped, line breaks as <br> so a numbered list stays in one cell. */
export const cell = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>").trim();
const table = (header, rows) => [
  `| ${header.join(" | ")} |`,
  `| ${header.map(() => "-----").join(" | ")} |`,
  ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
].join("\n");

// ---------- references ----------

/**
 * One reference as the catalogue writes it: `103-S1` (a spec scenario), `SCRUM-99/AC7` or `SCRUM-77-AC7` (an AC) or
 * `SCRUM-65` (a whole story). A trailing "?" means the AC still has to be confirmed against Jira.
 */
export function parseRef(ref) {
  const confirm = ref.endsWith("?");
  const clean = ref.replace(/\?$/, "");
  let m = /^(\d+)-S(\d+)$/.exec(clean);
  if (m) return { story: Number(m[1]), ac: null, scenario: clean, confirm };
  m = /^SCRUM-(\d+)(?:[/-]AC(\d+))?$/.exec(clean);
  if (m) return { story: Number(m[1]), ac: m[2] ? Number(m[2]) : null, scenario: null, confirm };
  throw new Error(`cannot read the reference "${ref}"`);
}

/** The (story, AC) pairs a reference gives credit to. A story-level reference has ac null: it names the story only. */
export function acsOfRef(ref, scenarios) {
  const r = parseRef(ref);
  if (r.scenario) {
    const acs = scenarios[r.scenario] ?? [];
    return acs.length ? acs.map((ac) => ({ story: r.story, ac })) : [{ story: r.story, ac: null }];
  }
  return [{ story: r.story, ac: r.ac }];
}

// ---------- results ----------

const SEVERITY = ["failed", "flaky", "skipped", "not-run", "expected-fail", "passed"]; // worst first

/** One Playwright test's outcome: passed, failed, flaky, skipped or expected-fail (a test.fail() that did fail, as it should). */
export function outcomeOf(test) {
  if (test.status === "skipped") return "skipped";
  if (test.status === "flaky") return "flaky";
  if (test.status === "unexpected") return "failed";
  return test.expectedStatus === "failed" ? "expected-fail" : "passed";
}

const worst = (outcomes) => SEVERITY.find((s) => outcomes.includes(s)) ?? "not-run";

/**
 * Every test in a Playwright JSON report, with the catalogue ID its title starts with (null for smoke and the like).
 * The `setup` project (sign-in) is left out: it is plumbing, not a case.
 */
export function readReport(report) {
  const tests = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        if (t.projectName === "setup") continue;
        const last = t.results?.at(-1);
        tests.push({
          id: /^(E2E-[A-Z]+-\d+)\b/.exec(spec.title)?.[1] ?? null,
          title: spec.title,
          file: spec.file ?? suite.file ?? null,
          outcome: outcomeOf(t),
          duration: last?.duration ?? 0,
          retries: Math.max(0, (t.results?.length ?? 1) - 1),
        });
      }
    }
    for (const s of suite.suites ?? []) walk(s);
  };
  for (const s of report.suites ?? []) walk(s);
  const totals = Object.fromEntries(SEVERITY.map((o) => [o, tests.filter((t) => t.outcome === o).length]));
  return {
    tests,
    totals: { tests: tests.length, ...totals },
    startTime: report.stats?.startTime ?? null,
    durationMs: report.stats?.duration ?? null,
    /** catalogue ID -> worst outcome of its tests */
    byId: new Map([...Map.groupBy(tests.filter((t) => t.id), (t) => t.id)].map(([id, ts]) => [id, worst(ts.map((t) => t.outcome))])),
  };
}

/** What a case's state is: its test's outcome, or not-run when its spec exists but the report has no row, or no-spec. */
export function caseState(id, specFiles, byId) {
  if (!specFiles.has(id)) return "no-spec";
  return byId?.get(id) ?? "not-run";
}

/** One AC's state from the states of the cases that cite it. */
export function acState(states) {
  if (states.length === 0) return "not-covered";
  if (states.includes("failed")) return "failed";
  if (states.includes("flaky")) return "flaky";
  if (states.includes("passed")) return "passed";
  const real = states.filter((s) => s !== "no-spec");
  return real.length ? worst(real) : "no-spec";
}

export const STATE_LABEL = {
  passed: "Passed", failed: "Failed", flaky: "Flaky", skipped: "Skipped", "expected-fail": "Expected fail",
  "not-run": "Not run", "no-spec": "No E2E spec yet", "not-covered": "Not covered",
};

// ---------- defects ----------

/** The rows of the hand-kept defects.md: { id, testId, story, description, severity, status, open }. */
export function parseDefects(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\|\s*(D-\d+)\s*\|(.*)\|\s*$/.exec(line);
    if (!m) continue;
    const cols = m[2].split(/(?<!\\)\|/).map((c) => c.trim());
    const [testId = "", story = "", description = "", severity = "", status = ""] = cols;
    out.push({ id: m[1], testId, story, description, severity, status, open: /^open\b/i.test(status) });
  }
  return out;
}

const defectsOf = (testId, defects) => defects.filter((d) => d.testId === testId).map((d) => d.id).join(", ");

// ---------- manual scripts and 02 test cases ----------

/**
 * What is wrong with the manual scripts: a catalogue case with no script, a script for an ID that is not in the catalogue, a
 * script with no preconditions, data, steps or expected results, or a set-up it names that does not exist. The generator refuses
 * to write while this list is not empty, so `02-test-cases.md` is never missing a script.
 */
export function manualProblems(catalogue, manual, setups) {
  const problems = [];
  const known = new Set(setups.map((x) => x.id));
  const ids = new Set(catalogue.map((c) => c.id));
  for (const c of catalogue) {
    const m = manual[c.id];
    if (!m) { problems.push(`${c.id} has no manual script`); continue; }
    if (!m.preconditions) problems.push(`${c.id} has no preconditions`);
    if (!m.data) problems.push(`${c.id} has no test data`);
    if (!m.steps?.length) problems.push(`${c.id} has no steps`);
    if (!m.expected?.length) problems.push(`${c.id} has no expected results`);
    for (const id of m.setups ?? []) if (!known.has(id)) problems.push(`${c.id} names an unknown set-up ${id}`);
  }
  for (const id of Object.keys(manual)) if (!ids.has(id)) problems.push(`a manual script exists for ${id}, which is not in the catalogue`);
  return problems;
}

const numbered = (items) => items.map((x, i) => `${i + 1}. ${x}`).join("\n");

export const COLUMNS_02 = ["Test ID", "Story / AC refs", "Scenario", "Preconditions", "Steps", "Test data", "Expected results", "Priority", "Type", "Features", "Week 7 changes", "Automated spec"];

/** One row per catalogue case in the fallback template columns (no course template was found), for the CSV. */
export function testCaseRows(catalogue, specFiles, manual) {
  return catalogue.map((c) => {
    const m = manual[c.id] ?? {};
    const setups = m.setups?.length ? `Set-ups: ${m.setups.join(", ")}. ` : "";
    return [
      c.id, c.refs.join(", "), c.scenario,
      setups + (m.preconditions ?? ""), numbered(m.steps ?? []), m.data ?? "", numbered(m.expected ?? []),
      c.priority, c.type, c.features.join(", "), c.changes.join(", ") || "-",
      specFiles.get(c.id) ?? "not written yet",
    ];
  });
}

/**
 * 02-test-cases.md: how to use it, the accounts, the set-ups, then every case as its own section (a table cell cannot hold a
 * numbered script). `meta` has the commit and the date; `manual` and `content` come from apps/web/tests/e2e/manual.
 */
export function renderTestCases(catalogue, specFiles, manual, content, meta) {
  const { setups, accounts, password, baseUrl } = content;
  const out = [
    "# E2E test cases (manual scripts)",
    "",
    `Generated by \`pnpm run e2e:docs\` from \`apps/web/tests/e2e/catalogue.ts\`, the scripts in \`apps/web/tests/e2e/manual\` and the spec files (commit ${meta.commit}, ${meta.date}). Do not edit by hand: change the catalogue or the scripts and regenerate.`,
    "",
    `Every case below is both an automated test (the **Automated spec**) and a script a person can follow in the browser against ${baseUrl}. No course template was found, so the fields are the plan's fallback set: preconditions, steps, test data, expected results.`,
    "",
    "How to run one: do the **Set-ups** it names, follow the **Steps**, compare what you see with **Expected results**, and record the run in [04-execution-log.md](04-execution-log.md) (who, when, commit, result, evidence). Where the automated test also checks the database, the script says what a person can see instead.",
    "",
    "Dates are 14 November 2031 unless a case says otherwise, so nothing depends on today. Use a separate private window for each person.",
    "",
    "**Status of these scripts.** They were written from the automated specs and the screens' labels, and no person has walked through them yet. The first manual run of a case should correct any wording that has drifted, and the person who ran it records that in [05-review-log.md](05-review-log.md) (\"Changes made in review\").",
    "",
    `## Accounts (password for all: \`${password}\`)`,
    "",
    table(["Name", "Email", "Role in the sign-in list"], accounts),
    "",
    "## Set-ups",
    "",
  ];
  for (const x of setups) out.push(`### ${x.id}: ${x.title}`, "", numbered(x.steps), "");
  out.push("## Cases", "", table(["Test ID", "Scenario", "Pri", "Type", "Automated spec"],
    catalogue.map((c) => [`[${c.id}](#${c.id.toLowerCase()})`, c.scenario, c.priority, c.type, specFiles.get(c.id) ?? "not written yet"])), "");
  for (const c of catalogue) {
    const m = manual[c.id];
    out.push(
      `### ${c.id}`, "",
      `**${c.title}**`, "",
      `- **Scenario:** ${c.scenario}`,
      `- **Checks:** ${c.refs.join(", ")}`,
      `- **Priority / type:** ${c.priority}, ${c.type}${c.changes.length ? `; Week 7 ${c.changes.join(", ")}` : ""}; features ${c.features.join(", ")}`,
      `- **Automated spec:** ${specFiles.get(c.id) ? `\`${specFiles.get(c.id)}\`` : "not written yet"}`,
      `- **Set-ups:** ${m.setups?.length ? m.setups.join(", ") : "none"}`,
      "", `**Preconditions.** ${m.preconditions}`, "", `**Test data.** ${m.data}`, "",
      "**Steps**", "", numbered(m.steps), "",
      "**Expected results**", "", numbered(m.expected), "",
    );
  }
  return out.join("\n");
}

// ---------- 03 traceability ----------

/**
 * Story -> AC -> E2E cases -> last result. `specs` is docs/specs merged ({ stories, scenarios }, as scripts/traceability parses
 * it). Only stories an E2E case names are listed AC by AC; every other spec's ACs are counted, not listed (unit and integration
 * tests cover them, see docs/traceability.md).
 */
export function buildTraceability({ catalogue, specs, specFiles, byId }) {
  const stateOf = (id) => caseState(id, specFiles, byId);
  const acCases = new Map(); // "story:ac" -> ids
  const storyLevel = new Map(); // story -> { ids, confirm }
  const cited = new Set();
  for (const c of catalogue) {
    for (const ref of c.refs) {
      const confirm = ref.endsWith("?");
      for (const { story, ac } of acsOfRef(ref, specs.scenarios)) {
        cited.add(story);
        if (ac === null) {
          const e = storyLevel.get(story) ?? { ids: [], confirm: false };
          if (!e.ids.includes(c.id)) e.ids.push(c.id);
          e.confirm ||= confirm;
          storyLevel.set(story, e);
        } else {
          const key = `${story}:${ac}`;
          const ids = acCases.get(key) ?? [];
          if (!ids.includes(c.id)) ids.push(c.id);
          acCases.set(key, ids);
        }
      }
    }
  }

  const stories = [];
  for (const story of [...cited].sort((a, b) => a - b)) {
    const spec = specs.stories[story];
    const acNumbers = new Set(Object.keys(spec?.acs ?? {}).map(Number));
    for (const key of acCases.keys()) if (key.startsWith(`${story}:`)) acNumbers.add(Number(key.split(":")[1]));
    const acs = [...acNumbers].sort((a, b) => a - b).map((ac) => {
      const ids = acCases.get(`${story}:${ac}`) ?? [];
      const text = spec?.acs[ac] ?? null;
      const dropped = /^[*(\s]*Dropped\b/i.test(text ?? "");
      return { ac, text, ids, dropped, state: dropped && !ids.length ? "dropped" : acState(ids.map(stateOf)) };
    });
    stories.push({ story, title: spec?.title ?? null, specFile: spec?.file ?? null, acs, storyLevel: storyLevel.get(story) ?? null });
  }

  const totalSpecAcs = Object.values(specs.stories).reduce((n, s) => n + Object.keys(s.acs).length, 0);
  const citedSpecAcs = stories.reduce((n, s) => n + (specs.stories[s.story] ? Object.keys(specs.stories[s.story].acs).length : 0), 0);
  const countAcs = (pred) => stories.reduce((n, s) => n + s.acs.filter((a) => a.text !== null && !a.dropped && pred(a)).length, 0);
  return {
    stories,
    stateOf,
    totalSpecAcs,
    citedSpecAcs,
    citedStories: stories.length,
    storiesWithSpec: stories.filter((s) => s.specFile).length,
    acsReferenced: countAcs((a) => a.ids.length > 0),
    acsPassed: countAcs((a) => a.state === "passed"),
    acsInCitedStories: countAcs(() => true),
  };
}

const short = (t, n = 140) => (t && t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t ?? "");

export function renderTraceability(tr, { specFiles, meta, notBuilt = NOT_BUILT }) {
  const lines = [
    "# E2E traceability matrix",
    "",
    `Generated by \`pnpm run e2e:docs\` (commit ${meta.commit}, ${meta.date}). Do not edit by hand. It maps each story an E2E case checks`,
    "to its acceptance criteria, the cases that check them, the spec file and the result of the last run.",
    "",
    `- ${tr.citedStories} stories are named by an E2E case; ${tr.storiesWithSpec} of them have a written spec, so their ACs are listed below one by one.`,
    `- ${tr.acsReferenced} of the ${tr.acsInCitedStories} ACs in those specs are named by an E2E case and ${tr.acsPassed} have a passing one in the last run.`,
    `- The other ${tr.totalSpecAcs - tr.citedSpecAcs} ACs in \`docs/specs\` are checked by unit and integration tests only (see [docs/traceability.md](../../traceability.md)).`,
    "- A story with no written spec is cited at story level, with the AC to confirm against Jira; it has no AC rows.",
    "",
    "## Not built, so not covered",
    "",
    ...(notBuilt.length
      ? [table(["Change", "Stories", "What is missing", "Defect", "E2E result"], notBuilt.map((n) => [n.change, n.stories.join(", "), n.what, n.defect, "Not covered"]))]
      : ["Nothing the customer asked for is left out: every Week 7 change is built and has an E2E case."]),
    "",
    "## Stories and acceptance criteria",
    "",
  ];
  for (const s of tr.stories) {
    lines.push(`### SCRUM-${s.story}${s.title ? ` ${s.title}` : ""}`, "");
    if (s.acs.length === 0) {
      lines.push(`No written spec. ${s.storyLevel.confirm ? "AC to confirm. " : ""}Cases at story level: ${s.storyLevel.ids.join(", ")}.`, "");
      continue;
    }
    const rows = s.acs.map((a) => [
      `AC${a.ac}`, short(a.text) || "(AC not in a spec)",
      a.ids.length ? a.ids.map((id) => `${id} (${specFiles.get(id) ? `\`${specFiles.get(id)}\`` : "no spec yet"})`).join("; ") : "-",
      a.state === "dropped" ? "Dropped in the spec" : STATE_LABEL[a.state] ?? a.state,
    ]);
    lines.push(table(["AC", "Criterion", "E2E cases (spec)", "Last result"], rows), "");
    if (s.storyLevel) lines.push(`Also cited at story level by ${s.storyLevel.ids.join(", ")}.`, "");
  }
  const noAc = tr.stories.filter((s) => s.acs.length === 0);
  if (noAc.length) {
    lines.push("## Stories cited without a written spec", "",
      table(["Story", "E2E cases", "AC"], noAc.map((s) => [`SCRUM-${s.story}`, s.storyLevel.ids.join(", "), s.storyLevel.confirm ? "To confirm against Jira" : "Story only"])), "");
  }
  return lines.join("\n");
}

export function traceabilityCsv(tr, specFiles, notBuilt = NOT_BUILT) {
  const rows = [];
  for (const s of tr.stories) {
    if (s.acs.length === 0) rows.push([`SCRUM-${s.story}`, "", "", s.storyLevel.ids.join("; "), s.storyLevel.ids.map((i) => specFiles.get(i) ?? "").join("; "), "Story level"]);
    for (const a of s.acs) rows.push([`SCRUM-${s.story}`, `AC${a.ac}`, a.text ?? "", a.ids.join("; "), a.ids.map((i) => specFiles.get(i) ?? "").join("; "), a.state === "dropped" ? "Dropped in the spec" : STATE_LABEL[a.state] ?? a.state]);
  }
  for (const n of notBuilt) rows.push([n.stories.join("; "), n.change, n.what, "", "", "Not covered (not built)"]);
  return toCsv(["Story", "AC", "Criterion", "E2E cases", "Spec files", "Last result"], rows);
}

// ---------- 04 execution log ----------

export const EXEC_HEADER = ["Run ID", "Date", "Executed by", "Commit", "Environment", "Test ID", "Result", "Evidence", "Defect ID"];

const tableRows = (text, firstHeaderCell) => {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(`| ${firstHeaderCell} |`));
  if (start < 0) return { start: -1, end: -1, rows: [], lines };
  let end = start + 2;
  while (end < lines.length && lines[end].startsWith("|")) end++;
  return { start, end, rows: lines.slice(start + 2, end), lines };
};

/**
 * Adds one run to the execution log: an automated row per test in the report, plus (once per case) a manual row whose
 * "Executed by" and result stay blank for a person. A run ID already in the log is not added again.
 */
export function updateExecutionLog(existing, { runId, date, commit, environment, evidence, report, catalogue, defects }) {
  const head = existing ?? [
    "# E2E execution log", "",
    "One row per case per run. Automated rows are written from `results.json` by `pnpm run e2e:docs` and never edited. Manual rows are",
    "added once per case with **Executed by** and **Result** blank: only a person who ran the case fills them in, with the date,",
    "the commit and where the evidence is.", "",
    `| ${EXEC_HEADER.join(" | ")} |`, `| ${EXEC_HEADER.map(() => "-----").join(" | ")} |`, "",
  ].join("\n");
  const parsed = tableRows(head, "Run ID");
  const rows = [...parsed.rows];
  const haveRun = rows.some((r) => r.startsWith(`| ${runId} |`));
  const haveManual = new Set(rows.filter((r) => r.startsWith("| manual |")).map((r) => r.split("|")[6]?.trim()));
  const row = (cols) => `| ${cols.map(cell).join(" | ")} |`;

  if (report && !haveRun) {
    for (const t of report.tests.filter((x) => x.id)) {
      rows.push(row([runId, date, "Playwright (automated)", commit, environment, t.id, STATE_LABEL[t.outcome], evidence, defectsOf(t.id, defects)]));
    }
  }
  for (const c of catalogue) {
    if (!haveManual.has(c.id)) rows.push(row(["manual", "", "", "", "", c.id, "", "", ""]));
  }
  const lines = parsed.lines;
  return [...lines.slice(0, parsed.start + 2), ...rows, ...lines.slice(parsed.end)].join("\n").replace(/\n*$/, "\n");
}

// ---------- 05 review log ----------

export const REVIEW_HEADER = ["Test ID", "Drafted by", "Reviewer", "Date", "AI self-checks", "Human checks (H1-H4)", "Changes made in review"];

/**
 * Adds a row for each catalogue ID the review log lacks. Existing rows are kept exactly as they are, so whatever a person or
 * the drafting AI wrote stays. A new row's Reviewer and Date are blank, and no check is recorded on anyone's behalf.
 */
export function mergeReviewLog(existing, catalogue) {
  const parsed = tableRows(existing, "Test ID");
  if (parsed.start < 0) throw new Error("05-review-log.md has no table that starts with | Test ID |");
  const have = new Set(parsed.rows.map((r) => r.split("|")[1]?.trim()));
  const added = catalogue.filter((c) => !have.has(c.id)).map((c) =>
    `| ${c.id} | AI (Claude Code) | | | Row generated for a new case: no self-check recorded yet. | | |`);
  const lines = parsed.lines;
  return { text: [...lines.slice(0, parsed.end), ...added, ...lines.slice(parsed.end)].join("\n"), added: added.length };
}

// ---------- metrics ----------

const countBy = (catalogue, key) => {
  const m = new Map();
  for (const c of catalogue) for (const k of [].concat(key(c))) m.set(k, [...(m.get(k) ?? []), c.id]);
  return m;
};

export function buildMetrics({ catalogue, specFiles, report, tr, defects, meta, notBuilt = NOT_BUILT }) {
  const byId = report?.byId ?? null;
  const state = (id) => caseState(id, specFiles, byId);
  const passedIds = new Set(catalogue.filter((c) => state(c.id) === "passed").map((c) => c.id));
  const group = (key) => [...countBy(catalogue, key)].sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true })).map(([k, ids]) => ({
    key: k, catalogue: ids.length, automated: ids.filter((i) => specFiles.has(i)).length, passed: ids.filter((i) => passedIds.has(i)).length,
  }));
  const featureIds = countBy(catalogue, (c) => c.features);
  const changeIds = countBy(catalogue, (c) => c.changes);
  const cover = (ids) => ({ inCatalogue: ids.length > 0, passed: ids.some((i) => passedIds.has(i)) });
  return {
    meta,
    totals: report?.totals ?? null,
    durationMs: report?.durationMs ?? null,
    cases: catalogue.length,
    automatedCases: catalogue.filter((c) => specFiles.has(c.id)).length,
    byPriority: group((c) => c.priority),
    byType: group((c) => c.type),
    byArea: group((c) => c.id.split("-")[1]),
    features: FEATURES.map((name, i) => ({ n: i + 1, name, ...cover(featureIds.get(i + 1) ?? []) })),
    changes: Object.entries(CHANGES).map(([k, name]) => ({ key: k, name, ...cover(changeIds.get(k) ?? []) })),
    acs: tr ? { referenced: tr.acsReferenced, passed: tr.acsPassed, inCited: tr.acsInCitedStories, citedStories: tr.citedStories, otherSpec: tr.totalSpecAcs - tr.citedSpecAcs } : null,
    defectsOpen: defects.filter((d) => d.open),
    defectsAll: defects.length,
    notBuilt,
  };
}

const dur = (ms) => (ms == null ? "n/a" : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`);

export function renderMetrics(m) {
  const t = m.totals;
  const out = [
    "# E2E metrics",
    "",
    `Generated by \`pnpm run e2e:metrics\` from Playwright's \`results.json\`, the catalogue and \`defects.md\`. Commit \`${m.meta.commit}\`, ${m.meta.timestamp}${m.meta.environment ? `, ${m.meta.environment}` : ""}.`,
    "",
    "## Run",
    "",
    t ? table(["Tests", "Passed", "Failed", "Flaky", "Skipped", "Expected fail", "Duration"],
      [[t.tests, t.passed, t.failed, t.flaky, t.skipped, t["expected-fail"], dur(m.durationMs)]])
      : "No results.json was found, so there is no run to report. The catalogue counts below still hold.",
    "",
    "An *expected fail* is a test marked `test.fail()` for an open defect: it failed, as the defect says it should. It turns into a failure the day the defect is fixed.",
    "",
    `## Cases (${m.cases} in the catalogue, ${m.automatedCases} with a spec)`,
    "",
  ];
  for (const [title, rows] of [["Priority", m.byPriority], ["Type", m.byType], ["Area", m.byArea]]) {
    out.push(table([title, "In catalogue", "With a spec", "Passed in this run"], rows.map((r) => [r.key, r.catalogue, r.automated, t ? r.passed : "n/a"])), "");
  }
  const cov = (rows, label) => rows.filter((r) => r.passed).length + ` of ${rows.length} ${label} have a passing case`;
  out.push(
    "## Coverage", "",
    `- Core features: ${cov(m.features, "features")}; ${m.features.filter((f) => f.inCatalogue).length} have a case in the catalogue.`,
    `- Week 7 changes: ${cov(m.changes, "changes")}; ${m.changes.filter((c) => c.inCatalogue).length} have a case in the catalogue.`,
    m.acs ? `- Acceptance criteria: ${m.acs.referenced} of the ${m.acs.inCited} ACs in the ${m.acs.citedStories} stories E2E cites are named by a case, and ${m.acs.passed} have a passing one. The other ${m.acs.otherSpec} ACs in \`docs/specs\` belong to stories no E2E case cites; unit and integration tests cover them.` : "",
    "",
    "Not covered:", "",
    ...m.features.filter((f) => !f.passed).map((f) => `- Feature ${f.n} ${f.name}: ${f.inCatalogue ? "has a case, none passing in this run" : "no case"}`),
    ...m.changes.filter((c) => !c.passed).map((c) => `- Change ${c.key} ${c.name}: ${c.inCatalogue ? "has a case, none passing in this run" : "no case" + (m.notBuilt.find((n) => n.change === c.key) ? ` (not built, defect ${m.notBuilt.find((n) => n.change === c.key).defect})` : "")}`),
    "",
    `## Defects (${m.defectsOpen.length} open of ${m.defectsAll})`,
    "",
    m.defectsOpen.length ? table(["ID", "Test", "Story", "Severity (proposed)"], m.defectsOpen.map((d) => [d.id, d.testId, d.story, d.severity])) : "None open.",
    "",
  );
  return out.join("\n");
}
