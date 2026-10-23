// SCRUM-52/AC3: an organiser who opens a request from My event requests sees what they submitted and the updates made during review

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getEvent, getEventChangeHistory } = vi.hoisted(() => ({ getEvent: vi.fn(), getEventChangeHistory: vi.fn() }));
vi.mock("@/lib/getEvent", () => ({
  getEvent,
  getEventOutcome: vi.fn(async () => null),
  getEventChangeHistory,
  getChangeRequests: vi.fn(async () => []),
  getEventSafetyDecisions: vi.fn(async () => null),
}));
vi.mock("@/lib/venueBookingsServer", () => ({ getEventVenueBookings: vi.fn(async () => null) }));
vi.mock("@/lib/equipmentRequestsServer", () => ({ getEventEquipmentRequests: vi.fn(async () => null) }));
vi.mock("@/lib/technicalAssignmentsServer", () => ({ getEventTechnicalAssignments: vi.fn(async () => null) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

import EventPage from "@/app/events/[id]/page";

/** The request as its organiser submitted it, as GET /events/:id sends it to them. */
const SUBMITTED = {
  id: "evt-1",
  name: "Tech Summit",
  status: "under_review",
  canChangeStatus: false,
  canReview: false,
  isOrganiser: true,
  canRequestChange: false,
  purpose: "Annual industry conference",
  preferred_start_datetime: "2026-11-14T01:00:00Z", // 9:00 am in Singapore
  preferred_end_datetime: "2026-11-14T09:00:00Z",
  expected_attendance: 250,
  preferred_layout_name: "Theatre",
  accessibility_requirements: "Wheelchair access to stage",
  equipment_requirements_notes: "2 projectors, 4 wireless mics",
  submitted_at: "2026-10-01T02:00:00Z",
  organiser_name: "Jason Chua",
  point_of_contact_name: "Rachel Tan",
};

const open = async (tab?: string) =>
  render(await EventPage({ params: Promise.resolve({ id: "evt-1" }), searchParams: Promise.resolve({ tab }) }));

/** The <dd> under a given <dt> label. */
const valueOf = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement;

describe("SCRUM-52/AC3 opening a request from My event requests", () => {
  beforeEach(() => {
    getEvent.mockReset().mockResolvedValue({ event: SUBMITTED });
    getEventChangeHistory.mockReset().mockResolvedValue(null);
    // the comments section loads from the browser
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ can_comment: false, comments: [] }) })));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("SCRUM-52/AC3 loads the request the list linked to, and shows its name and current status", async () => {
    await open();

    expect(getEvent).toHaveBeenCalledWith("evt-1");
    expect(screen.getByRole("heading", { name: "Tech Summit" })).toBeTruthy();
    expect(screen.getAllByText("Under Review").length).toBeGreaterThan(0);
  });

  it("SCRUM-52/AC3 shows every detail the organiser submitted", async () => {
    await open();

    expect(screen.getByRole("heading", { name: "Request details" })).toBeTruthy();
    expect(valueOf("Purpose").textContent).toBe("Annual industry conference");
    expect(valueOf("Expected attendees").textContent).toBe("250 people");
    expect(valueOf("Layout preference").textContent).toBe("Theatre");
    expect(valueOf("Accessibility needs").textContent).toBe("Wheelchair access to stage");
    expect(valueOf("Equipment needs").textContent).toBe("2 projectors, 4 wireless mics");
    expect(valueOf("Submitted").textContent).toMatch(/1 Oct 2026/);
  });

  it("SCRUM-52/AC3 shows the details as updated during review, not as first submitted", async () => {
    getEvent.mockResolvedValue({ event: { ...SUBMITTED, expected_attendance: 300, purpose: "Annual industry conference and expo" } });

    await open();

    expect(valueOf("Expected attendees").textContent).toBe("300 people");
    expect(valueOf("Purpose").textContent).toBe("Annual industry conference and expo");
  });

  it("SCRUM-52/AC3 shows the updates made during review, who made them and what changed", async () => {
    getEventChangeHistory.mockResolvedValue([
      {
        id: "h-1",
        changedAt: "2026-10-05T03:00:00+00:00",
        changedBy: "Rachel Tan",
        important: true,
        changes: [{ field: "expected_attendance", label: "Expected attendance", from: 250, to: 300 }],
      },
    ]);

    await open("changes");

    expect(getEventChangeHistory).toHaveBeenCalledWith("evt-1");
    const history = screen.getByRole("heading", { name: "Change history" }).closest("section") as HTMLElement;
    expect(within(history).getByText(/Rachel Tan/)).toBeTruthy();
    expect(within(history).getByText("Important")).toBeTruthy();
    expect(history.textContent).toContain("Expected attendance: 250 → 300");
  });

  it("SCRUM-52/AC3 shows event-service's message when the request cannot be opened (another organiser's looks like a missing one)", async () => {
    getEvent.mockResolvedValue({ error: "Event not found." });

    await open();

    expect(screen.getByRole("alert").textContent).toBe("Event not found.");
    expect(screen.queryByRole("heading", { name: "Request details" })).toBeNull();
  });
});
