// SCRUM-99 — the information a Safety Officer needs for an Operational Safety Check

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SafetyCheckInfo } from "@/components/SafetyCheckInfo";
import type { SafetyCheckDetails } from "@/lib/safetyCheckServer";

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

/** The text under the section headed `heading`. */
const section = (heading: string) => within(screen.getByRole("region", { name: heading })).getByRole("list").textContent;

describe("SCRUM-99/AC3 view safety information", () => {
  it("SCRUM-99/AC3 shows attendance, venue capacity and layout, emergency access, accessibility, equipment placement and restrictions", () => {
    render(<SafetyCheckInfo details={details()} />);

    expect(section("Expected attendance")).toContain("120");
    expect(section("Venue capacity and layout")).toContain("Riverside Hall: holds 150, 130 in Theatre layout");
    expect(section("Emergency access")).toContain("Riverside Hall: Two fire exits on the east wall");
    expect(section("Accessibility requirements")).toContain("Two wheelchair spaces near the stage");
    expect(section("Accessibility requirements")).toContain("Riverside Hall: Step-free entrance");
    expect(section("Equipment placement")).toContain("PA System × 2: Either side of the stage");
    expect(section("Known venue restrictions")).toContain("Riverside Hall: No open flames");
    expect(section("Known venue restrictions")).toContain("Riverside Hall unavailable (maintenance): East lift out of service");
  });

  it("SCRUM-99/AC3 says Not recorded where the information is missing, so the gap is visible", () => {
    const bare = details().venues[0];
    render(
      <SafetyCheckInfo
        details={details({
          expected_attendance: null,
          layout: null,
          accessibility_requirements: null,
          venues: [{ ...bare, layout_capacity: null, emergency_access: null, accessibility_notes: null, restrictions: null, unavailability: [] }],
          equipment: [{ name: "PA System", quantity: 2, placement: null }],
        })}
      />,
    );

    expect(section("Expected attendance")).toBe("Not recorded");
    expect(section("Venue capacity and layout")).toBe("Riverside Hall: holds 150 (no layout chosen)");
    expect(section("Emergency access")).toBe("Riverside Hall: Not recorded");
    expect(section("Accessibility requirements")).toBe("Event: Not recordedRiverside Hall: Not recorded");
    expect(section("Equipment placement")).toBe("PA System × 2: Not recorded");
    expect(section("Known venue restrictions")).toBe("Riverside Hall: Not recorded");
  });

  it("SCRUM-99/AC3 says so when the event has no equipment", () => {
    render(<SafetyCheckInfo details={details({ equipment: [] })} />);

    expect(section("Equipment placement")).toBe("No equipment requested");
  });

  it("SCRUM-99/AC3 flags a venue that has no capacity listed for the event's layout", () => {
    render(<SafetyCheckInfo details={details({ venues: [{ ...details().venues[0], layout_capacity: null }] })} />);

    expect(section("Venue capacity and layout")).toBe("Riverside Hall: holds 150, Theatre layout not listed for this venue");
  });
});
