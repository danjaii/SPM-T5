import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventRequestDetails, NOT_PROVIDED } from "@/components/EventRequestDetails";
import type { EventDetailView } from "@/lib/events";

const FULL: EventDetailView = {
  id: "evt-1",
  name: "Tech Summit",
  status: "submitted",
  canChangeStatus: false,
  purpose: "Annual industry conference",
  preferred_start_datetime: "2026-11-14T01:00:00Z", // 9:00 am in Singapore
  preferred_end_datetime: "2026-11-14T09:00:00Z", // 5:00 pm in Singapore
  expected_attendance: 250,
  preferred_layout_name: "Theatre",
  accessibility_requirements: "Wheelchair access to stage",
  equipment_requirements_notes: "2 projectors, 4 wireless mics",
  submitted_at: "2026-10-01T02:00:00Z",
  organiser_name: "Sam Tan",
};

const EMPTY: EventDetailView = {
  ...FULL,
  purpose: null,
  preferred_start_datetime: null,
  preferred_end_datetime: null,
  expected_attendance: null,
  preferred_layout_name: null,
  accessibility_requirements: null,
  equipment_requirements_notes: null,
  submitted_at: null,
  organiser_name: null,
};

/** The <dd> shown under a given <dt> label. */
function valueOf(label: string) {
  const term = screen.getByText(label, { selector: "dt" });
  return term.nextElementSibling as HTMLElement;
}

describe("SCRUM-23/AC2 — coordinator views the full event request", () => {
  it("shows every field the organiser submitted", () => {
    render(<EventRequestDetails event={FULL} />);

    expect(screen.getByRole("heading", { name: "Request details" })).toBeTruthy();
    expect(valueOf("Organiser").textContent).toBe("Sam Tan");
    expect(valueOf("Purpose").textContent).toBe("Annual industry conference");
    expect(valueOf("Expected attendees").textContent).toBe("250 people");
    expect(valueOf("Layout preference").textContent).toBe("Theatre");
    expect(valueOf("Accessibility needs").textContent).toBe("Wheelchair access to stage");
    expect(valueOf("Equipment needs").textContent).toBe("2 projectors, 4 wireless mics");
    expect(valueOf("Submitted").textContent).toMatch(/1 Oct 2026/);
  });

  it("shows the preferred start and end in Singapore time", () => {
    render(<EventRequestDetails event={FULL} />);

    const slot = valueOf("Preferred date and time").textContent ?? "";
    expect(slot).toMatch(/14 Nov 2026.*9:00.*–.*14 Nov 2026.*5:00/);
  });

  it("shows just the start when no end time was given", () => {
    render(<EventRequestDetails event={{ ...FULL, preferred_end_datetime: null }} />);

    const slot = valueOf("Preferred date and time").textContent ?? "";
    expect(slot).toMatch(/14 Nov 2026.*9:00/);
    expect(slot).not.toContain("–");
  });
});

describe("SCRUM-23/AC3 — missing optional information", () => {
  it("says a field was not provided instead of showing blank or misleading values", () => {
    const { container } = render(<EventRequestDetails event={EMPTY} />);

    const values = [...container.querySelectorAll("dd")];
    expect(values).toHaveLength(8);
    for (const value of values) expect(value.textContent).toBe(NOT_PROVIDED);
  });

  it("treats an empty string as not provided", () => {
    render(<EventRequestDetails event={{ ...FULL, purpose: "" }} />);

    expect(valueOf("Purpose").textContent).toBe(NOT_PROVIDED);
  });

  it("shows zero expected attendees as a number, not as missing", () => {
    render(<EventRequestDetails event={{ ...FULL, expected_attendance: 0 }} />);

    expect(valueOf("Expected attendees").textContent).toBe("0 people");
  });
});
