// SCRUM-175 — Traceability matrix from user stories to tests. Run: node --test "scripts/traceability/*.test.mjs"
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSpec, refsOf } from "./lib.mjs";

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
