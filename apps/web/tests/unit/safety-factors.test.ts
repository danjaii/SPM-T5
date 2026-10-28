// SCRUM-142/AC2 — the six factors a Safety Officer checks, and the reason built from the ones flagged

import { describe, expect, it } from "vitest";

import type { SafetyCheckDetails } from "@/lib/safetyCheckServer";
import { composeReason, safetyFactors } from "@/lib/safetyFactors";

const details = (over: Partial<SafetyCheckDetails> = {}): SafetyCheckDetails => ({
  id: "evt-1",
  name: "Tech Summit",
  status: "awaiting_arrangements",
  preferred_start_datetime: "2031-06-15T01:00:00Z",
  preferred_end_datetime: "2031-06-15T09:00:00Z",
  expected_attendance: 120,
  layout: "Theatre",
  accessibility_requirements: "Two wheelchair spaces near the stage",
  venues: [
    {
      name: "Riverside Hall",
      start: "2031-06-15T01:00:00Z",
      end: "2031-06-15T09:00:00Z",
      max_capacity: 150,
      layout_capacity: 130,
      emergency_access: "Two fire exits on the east wall",
      accessibility_notes: "Step-free entrance",
      restrictions: "No open flames",
      unavailability: [{ reason: "maintenance", notes: "East lift out of service", start: "2031-06-14T00:00:00Z", end: "2031-06-16T00:00:00Z" }],
    },
  ],
  equipment: [{ name: "PA System", quantity: 2, placement: "Either side of the stage" }],
  decisions: [],
  ...over,
});

/** The lines of the factor called `title`. */
const lines = (d: SafetyCheckDetails, title: string) => safetyFactors(d).find((f) => f.title === title)?.lines;

describe("SCRUM-142/AC2 the checklist lists every factor", () => {
  it("SCRUM-142/AC2 lists attendance vs capacity, emergency access, accessibility, equipment placement, crowd movement and venue restrictions, in that order", () => {
    expect(safetyFactors(details()).map((f) => f.title)).toEqual([
      "Attendance vs capacity",
      "Emergency access",
      "Accessibility",
      "Equipment placement",
      "Crowd movement",
      "Known venue restrictions",
    ]);
  });

  it("SCRUM-142/AC2 shows attendance against each venue's capacity, with the layout", () => {
    expect(lines(details(), "Attendance vs capacity")).toEqual(["Expected attendance: 120", "Riverside Hall: holds 150, 130 in Theatre layout"]);
  });

  it("SCRUM-142/AC2 shows emergency access, accessibility, equipment placement and restrictions", () => {
    const d = details();
    expect(lines(d, "Emergency access")).toEqual(["Riverside Hall: Two fire exits on the east wall"]);
    expect(lines(d, "Accessibility")).toEqual(["Event: Two wheelchair spaces near the stage", "Riverside Hall: Step-free entrance"]);
    expect(lines(d, "Equipment placement")).toEqual(["PA System × 2: Either side of the stage"]);
    expect(lines(d, "Known venue restrictions")).toEqual([
      "Riverside Hall: No open flames",
      "Riverside Hall unavailable (maintenance): East lift out of service",
    ]);
  });

  it("SCRUM-142/AC2 says Not recorded where the information is missing, so the gap is visible", () => {
    const bare = details().venues[0];
    const d = details({
      expected_attendance: null,
      layout: null,
      accessibility_requirements: null,
      venues: [{ ...bare, layout_capacity: null, emergency_access: null, accessibility_notes: null, restrictions: null, unavailability: [] }],
      equipment: [{ name: "PA System", quantity: 2, placement: null }],
    });

    expect(lines(d, "Attendance vs capacity")).toEqual(["Expected attendance: Not recorded", "Riverside Hall: holds 150 (no layout chosen)"]);
    expect(lines(d, "Emergency access")).toEqual(["Riverside Hall: Not recorded"]);
    expect(lines(d, "Accessibility")).toEqual(["Event: Not recorded", "Riverside Hall: Not recorded"]);
    expect(lines(d, "Equipment placement")).toEqual(["PA System × 2: Not recorded"]);
    expect(lines(d, "Crowd movement")).toEqual(["Not recorded"]);
    expect(lines(d, "Known venue restrictions")).toEqual(["Riverside Hall: Not recorded"]);
  });

  it("SCRUM-142/AC2 says so when the event has no equipment", () => {
    expect(lines(details({ equipment: [] }), "Equipment placement")).toEqual(["No equipment requested"]);
  });

  it("SCRUM-142/AC2 flags a venue that has no capacity listed for the event's layout", () => {
    const d = details({ venues: [{ ...details().venues[0], layout_capacity: null }] });
    expect(lines(d, "Attendance vs capacity")?.[1]).toBe("Riverside Hall: holds 150, Theatre layout not listed for this venue");
  });
});

describe("SCRUM-142/AC3 the reason sent with a decision", () => {
  it("SCRUM-142/AC3 puts the officer's note first, then each concern as 'Factor: what needs to change'", () => {
    expect(
      composeReason("  Please re-plan  ", [
        { title: "Equipment placement", note: " Run the cables under the stage " },
        { title: "Crowd movement", note: "Stagger breakouts" },
      ]),
    ).toBe("Please re-plan\nEquipment placement: Run the cables under the stage\nCrowd movement: Stagger breakouts");
  });

  it("SCRUM-142/AC3 leaves out a concern that has no note, and is empty when there is nothing to say", () => {
    expect(composeReason("", [{ title: "Crowd movement", note: "  " }])).toBe("");
  });
});
