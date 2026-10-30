// SCRUM-175 — Traceability matrix from user stories to tests. Run: node --test "scripts/traceability/*.test.mjs"
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMatrix, lineOf, parseSpec, refsOf, renderMarkdown } from "./lib.mjs";

describe("SCRUM-175/AC1 which story and AC a test checks, from its name", () => {
  it("reads a story and its AC", () => {
    assert.deepEqual(refsOf("SCRUM-68/AC1 view profile > shows the name", {}), [{ story: 68, ac: 1 }]);
  });

  it("reads several ACs of one story, and several stories", () => {
    assert.deepEqual(refsOf("SCRUM-174/AC1,AC7 keeps it cancelled", {}), [{ story: 174, ac: 1 }, { story: 174, ac: 7 }]);
    assert.deepEqual(refsOf("SCRUM-6/AC1, SCRUM-7/AC2 both", {}), [{ story: 6, ac: 1 }, { story: 7, ac: 2 }]);
  });

  it("reads a scenario ID through the spec's scenario table", () => {
    const scenarios = { "174-S3": [3], "174-S10": [7] };
    assert.deepEqual(refsOf("174-S3 cancels every active booking", scenarios), [{ story: 174, ac: 3 }]);
    assert.deepEqual(refsOf("174-S10 174-S11 keeps it cancelled", scenarios), [{ story: 174, ac: 7 }, { story: 174, ac: null }]);
  });

  it("does not read a scenario ID out of a longer number or a date", () => {
    assert.deepEqual(refsOf("refuses 2031-03-03 bookings", {}), []);
    assert.deepEqual(refsOf("x1174-S3 is not a scenario", {}), []);
  });

  it("keeps a story named without an AC, with no AC", () => {
    assert.deepEqual(refsOf("SCRUM-8 — Edit event status > lets a coordinator change it", {}), [{ story: 8, ac: null }]);
  });

  it("names each story and AC once, even when the name repeats them", () => {
    assert.deepEqual(refsOf("SCRUM-174 cancel > 174-S2 SCRUM-174/AC2 cancels it", { "174-S2": [2] }), [{ story: 174, ac: 2 }]);
  });

  it("finds nothing in a test that names no story", () => {
    assert.deepEqual(refsOf("health > reports ok status", {}), []);
  });
});

describe("SCRUM-175/AC2 a story's full list of ACs, and its scenarios, from its spec", () => {
  it("reads ACs written as *AC1.*, **AC1**, | AC1 | and numbered **AC1** under a SCRUM header", () => {
    const spec = [
      "## SCRUM-102 Change or Cancel One Venue Booking",
      "*AC1.* Given that an event has more than one venue booking, when I change one, then only it is checked.",
      "*AC2.* Given that, when I cancel one, then only it is cancelled.",
      "## SCRUM-174 Cancel an Event",
      "1. **AC1** Given I am the assigned coordinator, when I cancel without a reason, then it is refused.",
      "## SCRUM-99 Safety check",
      "| AC1 | An event must complete a safety check before preparation | `events_safety_gate` |",
    ].join("\n");

    const { stories } = parseSpec(spec, "x.md");

    assert.deepEqual(Object.keys(stories).map(Number), [99, 102, 174]);
    assert.equal(stories[102].title, "Change or Cancel One Venue Booking");
    assert.deepEqual(Object.keys(stories[102].acs).map(Number), [1, 2]);
    assert.match(stories[102].acs[1], /^Given that an event has more than one venue booking/);
    assert.match(stories[174].acs[1], /^Given I am the assigned coordinator/);
    assert.match(stories[99].acs[1], /^An event must complete a safety check/);
  });

  it("takes the story from the key table when the spec has no SCRUM header", () => {
    const spec = ["| Key | Title |", "| --- | --- |", "| SCRUM-49 | Create and Submit an Event Request |", "| AC1 | The organiser fills in the form |"].join("\n");

    const { stories } = parseSpec(spec, "SCRUM-49-create-submit-event-request.md");

    assert.equal(stories[49].title, "Create and Submit an Event Request");
    assert.deepEqual(Object.keys(stories[49].acs).map(Number), [1]);
  });

  it("maps each scenario to its ACs from the scenario table", () => {
    const spec = ["| ID | AC | Given |", "| 174-S1 | AC1 | x |", "| 174-S13 | AC1, AC2 | y |", "| 36-S4 | — | z |"].join("\n");

    const { scenarios } = parseSpec(spec, "x.md");

    assert.deepEqual(scenarios, { "174-S1": [1], "174-S13": [1, 2], "36-S4": [] });
  });
});

describe("SCRUM-175/AC1 where each test is, so the matrix can link to it", () => {
  const source = [
    'describe("SCRUM-174 — Cancel an event", () => {',
    '  it("174-S2 SCRUM-174/AC2 cancels the event", async () => {});',
    '  it.each(["", "   "])("174-S1 SCRUM-174/AC1 refuses no reason (%j)", async (reason) => {});',
    '  it(`SCRUM-12/AC1: shows an error next to ${field} when empty`, () => {});',
    "});",
  ].join("\n");

  it("finds a test's line from the last part of its name", () => {
    assert.equal(lineOf(source, "SCRUM-174 — Cancel an event > 174-S2 SCRUM-174/AC2 cancels the event"), 2);
  });

  it("finds an it.each test, whose name has the value filled in", () => {
    assert.equal(lineOf(source, 'SCRUM-174 — Cancel an event > 174-S1 SCRUM-174/AC1 refuses no reason ("   ")'), 3);
  });

  it("finds a test named with a template string", () => {
    assert.equal(lineOf(source, "x > SCRUM-12/AC1: shows an error next to email when empty"), 4);
  });

  it("gives no line when the name cannot be found", () => {
    assert.equal(lineOf(source, "x > a test that is not here"), null);
  });
});

describe("SCRUM-175/AC1,AC2 the matrix: each story's ACs with their tests, and what is not covered", () => {
  const specs = {
    stories: { 174: { title: "Cancel an Event", acs: { 1: "Reason required", 2: "Recorded", 3: "Bookings released" }, file: "cancel-event.md" } },
    scenarios: {},
  };
  const test = (name, line, file = "services/event-service/tests/unit/event-status.test.ts") => ({ name, file, line });

  const matrix = buildMatrix(
    [
      test("SCRUM-174/AC1 refuses no reason (\"\")", 3),
      test("SCRUM-174/AC1 refuses no reason (\"   \")", 3),
      test("SCRUM-174/AC2 records the reason", 7),
      test("SCRUM-174 — a story-level test", 9),
      test("SCRUM-68/AC1 shows the profile", 26, "services/auth-service/tests/unit/profile.test.ts"),
      test("health > reports ok", 4, "services/auth-service/tests/unit/health.test.ts"),
    ],
    specs,
  );

  it("lists the stories in number order, with the spec's title where there is one", () => {
    assert.deepEqual(matrix.stories.map((s) => [s.story, s.title]), [[68, null], [174, "Cancel an Event"]]);
  });

  it("gives each AC its text and tests; an it.each test's cases count once, with how many there are", () => {
    const ac1 = matrix.stories[1].acs[0];
    assert.equal(ac1.text, "Reason required");
    assert.deepEqual(ac1.tests, [{ file: "services/event-service/tests/unit/event-status.test.ts", line: 3, name: 'SCRUM-174/AC1 refuses no reason ("")', cases: 2 }]);
  });

  it("marks an AC in the spec with no test as not covered, rather than leaving it out (AC2)", () => {
    assert.deepEqual(matrix.stories[1].acs.map((a) => [a.ac, a.covered]), [[1, true], [2, true], [3, false]]);
  });

  it("keeps tests that name the story but no AC apart, and counts tests that name no story", () => {
    assert.deepEqual(matrix.stories[1].storyLevel.map((t) => t.line), [9]);
    assert.equal(matrix.untraced, 1);
    assert.equal(matrix.total, 6);
  });

  it("says whether a story's AC list came from its spec, since only then can a gap be shown", () => {
    assert.deepEqual(matrix.stories.map((s) => s.fromSpec), [false, true]);
  });
});

describe("SCRUM-175/AC1,AC3 the matrix as Markdown", () => {
  const matrix = buildMatrix(
    [
      { name: "SCRUM-174/AC1 refuses no reason", file: "services/event-service/tests/unit/event-status.test.ts", line: 3 },
    ],
    { stories: { 174: { title: "Cancel an Event", acs: { 1: "Reason required", 2: "Recorded" }, file: "cancel-event.md" } }, scenarios: {} },
  );
  const md = renderMarkdown(matrix, { date: "2026-10-30", commit: "abc1234", passed: 4425 });

  it("says at the top when it was made, from which commit, that the tests passed, and how to rerun one story's tests (AC3)", () => {
    assert.match(md, /Generated 2026-10-30 from commit `abc1234`/);
    assert.match(md, /4425 tests passed/);
    assert.match(md, /pnpm vitest run -t "SCRUM-68\|68-S\[0-9\]"/);
    assert.match(md, /pnpm run traceability/);
  });

  it("links each test to its file and line, relative to docs/ (AC1)", () => {
    assert.match(md, /\[event-status\.test\.ts:3\]\(\.\.\/services\/event-service\/tests\/unit\/event-status\.test\.ts#L3\)/);
  });

  it("writes Not covered for an AC with no test (AC2)", () => {
    assert.match(md, /\| AC2 \| Recorded \| \*\*Not covered\*\* \|/);
  });
});
