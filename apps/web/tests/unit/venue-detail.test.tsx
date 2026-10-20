import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VenueDetail } from "@/components/VenueDetail";

// ---------------------------------------------------------------------------
// SCRUM-29 — Venue catalogue page (detail)
// ---------------------------------------------------------------------------
describe("SCRUM-29 — Venue detail", () => {
  // AC2 (Scenario 2): the detail view shows all of the venue's characteristics
  it("shows the venue's capacity, location, layouts, accessibility and facilities", () => {
    render(
      <VenueDetail
        venue={{
          id: "orchid",
          name: "Orchid Hall",
          address: "Level 3, East Wing",
          description: null,
          max_capacity: 150,
          operating_hours_start: null,
          operating_hours_end: null,
          is_accessible: true,
          accessibility_notes: "Step-free access, Hearing loop",
          layouts: [
            { name: "Theatre", max_capacity: 150 },
            { name: "Classroom", max_capacity: 80 },
            { name: "Banquet", max_capacity: 100 },
          ],
          facilities: ["Projector", "PA system", "Video conferencing"],
          setup_minutes: 0,
          turnaround_minutes: 0,
          can_edit_timing: false,
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Orchid Hall" })).toBeTruthy();
    expect(screen.getByText("Level 3, East Wing")).toBeTruthy();
    expect(screen.getByText("150 people")).toBeTruthy();
    expect(screen.getByText("Theatre")).toBeTruthy();
    expect(screen.getByText("Classroom")).toBeTruthy();
    expect(screen.getByText("Banquet")).toBeTruthy();
    expect(screen.getByText("Step-free access")).toBeTruthy();
    expect(screen.getByText("Hearing loop")).toBeTruthy();
    expect(screen.getByText("Projector")).toBeTruthy();
    expect(screen.getByText("PA system")).toBeTruthy();
    expect(screen.getByText("Video conferencing")).toBeTruthy();
  });
  // end of AC2
});
// end of SCRUM-29
