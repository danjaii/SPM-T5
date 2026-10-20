import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getEvent, getEventOutcome } = vi.hoisted(() => ({ getEvent: vi.fn(), getEventOutcome: vi.fn() }));
const { getEventVenueBookings } = vi.hoisted(() => ({ getEventVenueBookings: vi.fn() }));
const { getEventChangeHistory } = vi.hoisted(() => ({ getEventChangeHistory: vi.fn(async () => null as unknown) }));
// SCRUM-67: the assigned coordinator's page now loads the change requests too
const { getChangeRequests } = vi.hoisted(() => ({ getChangeRequests: vi.fn(async () => [] as unknown[]) }));
// SCRUM-100/AC7: and the Safety Officer's requested changes
const { getEventSafetyDecisions } = vi.hoisted(() => ({ getEventSafetyDecisions: vi.fn(async () => null as unknown) }));
vi.mock("@/lib/getEvent", () => ({ getEvent, getEventOutcome, getEventChangeHistory, getChangeRequests, getEventSafetyDecisions }));
vi.mock("@/lib/venueBookingsServer", () => ({ getEventVenueBookings }));
const { getEventEquipmentRequests } = vi.hoisted(() => ({ getEventEquipmentRequests: vi.fn() }));
vi.mock("@/lib/equipmentRequestsServer", () => ({ getEventEquipmentRequests }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

import EventPage from "@/app/events/[id]/page";

const open = async (id: string, tab?: string) => render(await EventPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ tab }) }));

// The browser-side sections load from event-service: comments get a thread, everything else a list.
const stubEventService = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (String(url).endsWith("/comments") ? { can_comment: true, comments: [] } : []),
    })),
  );

describe("Event status page route (/events/[id])", () => {
  beforeEach(() => {
    getEventVenueBookings.mockReset().mockResolvedValue(null);
    getEventOutcome.mockReset().mockResolvedValue(null);
    getEventEquipmentRequests.mockReset().mockResolvedValue(null);
    stubEventService();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows the event it was asked for", async () => {
    getEvent.mockResolvedValue({ event: { id: "evt-1", name: "Tech Summit", status: "approved", canChangeStatus: false } });

    await open("evt-1");

    expect(getEvent).toHaveBeenCalledWith("evt-1");
    expect(screen.getByRole("heading", { name: "Tech Summit" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /back to dashboard/i }).getAttribute("href")).toBe("/dashboard");
  });

  it("SCRUM-25/AC1 shows the event's comments section", async () => {
    getEvent.mockResolvedValue({ event: { id: "evt-1", name: "Tech Summit", status: "submitted", canChangeStatus: false } });

    await open("evt-1");

    expect(await screen.findByRole("heading", { name: "Comments" })).toBeTruthy();
  });

  // SCRUM-83/AC15: the event's organiser and coordinator (the only viewers of this page) reach its registrations from here
  it("SCRUM-83/AC15 links to the event's registration information page", async () => {
    getEvent.mockResolvedValue({ event: { id: "evt-1", name: "Tech Summit", status: "confirmed", canChangeStatus: false } });

    await open("evt-1", "registrations");

    expect(screen.getByRole("link", { name: "View registrations" }).getAttribute("href")).toBe("/events/evt-1/registrations");
  });

  it("SCRUM-86/AC2 shows the event's equipment requests, when the viewer may see them", async () => {
    getEvent.mockResolvedValue({ event: { id: "evt-1", name: "Tech Summit", status: "planning", canChangeStatus: true } });
    getEventEquipmentRequests.mockResolvedValue({
      requests: [{ id: "r1", equipment: "Audio: Wireless Microphone Set", quantity: 4, venueName: "Grand Hall", notes: null, status: "SUBMITTED", statusLabel: "Submitted" }],
      canCreate: true,
    });

    await open("evt-1", "equipment");

    expect(getEventEquipmentRequests).toHaveBeenCalledWith("evt-1");
    expect(screen.getByRole("heading", { name: "Equipment requests" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "Audio: Wireless Microphone Set" })).toBeTruthy();
  });

  it("SCRUM-86/AC7 shows no equipment section to a viewer equipment-service answers nothing for", async () => {
    getEvent.mockResolvedValue({ event: { id: "evt-1", name: "Tech Summit", status: "planning", canChangeStatus: false } });

    await open("evt-1", "equipment");

    expect(screen.getByText("This is not available to you for this event.")).toBeTruthy();
  });

  it("shows event-service's message when the event can't be shown", async () => {
    getEvent.mockResolvedValue({ error: "Event not found." });

    await open("missing");

    expect(screen.getByRole("alert").textContent).toBe("Event not found.");
  });

  // SCRUM-79/AC9: the reassign action half was retired; a Lead reassigns from the Lead's pages now
  it("SCRUM-42/AC5: shows the assigned coordinator", async () => {
    getEvent.mockResolvedValue({
      event: { id: "evt-1", name: "Tech Summit", status: "submitted", canChangeStatus: false, canReview: false,
        point_of_contact_name: "Alice Coord" },
    });

    await open("evt-1", "changes");

    expect(screen.getByRole("heading", { name: "Coordinator" })).toBeTruthy();
    expect(screen.getByText("Alice Coord")).toBeTruthy();
  });

  it("SCRUM-23/AC2: the overview reads top to bottom — details, comments, then the manual status change", async () => {
    getEvent.mockResolvedValue({
      event: { id: "evt-1", name: "Tech Summit", status: "submitted", canChangeStatus: true, canReview: false,
        point_of_contact_name: "Alice Coord", organiser_name: "Sam Tan" },
    });

    await open("evt-1");
    await screen.findByRole("heading", { name: "Comments" }); // SCRUM-25: loads from the browser

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Request details", "Comments", "Change status"]);
  });

  it("SCRUM-23/AC1, AC2: shows the full request details alongside the status", async () => {
    getEvent.mockResolvedValue({
      event: {
        id: "evt-1", name: "Tech Summit", status: "submitted", canChangeStatus: false,
        purpose: "Annual industry conference", preferred_start_datetime: null, preferred_end_datetime: null,
        expected_attendance: 250, preferred_layout_name: "Theatre", accessibility_requirements: null,
        equipment_requirements_notes: null, submitted_at: "2026-10-01T02:00:00Z", organiser_name: "Sam Tan",
      },
    });

    await open("evt-1");

    expect(screen.getByText("Submitted", { selector: "header [data-tone]" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Request details" })).toBeTruthy();
    expect(screen.getByText("Sam Tan")).toBeTruthy();
    expect(screen.getByText("Annual industry conference")).toBeTruthy();
  });

  it.each([
    ["a role that may not view events", "You are not allowed to view this event's status."],
    ["someone else's event", "Event not found."],
  ])("SCRUM-23/AC4: hides the request details for %s", async (_case, error) => {
    getEvent.mockResolvedValue({ error });

    await open("evt-1");

    expect(screen.getByRole("alert").textContent).toBe(error);
    expect(screen.queryByRole("heading", { name: "Request details" })).toBeNull();
    expect(getEventVenueBookings).not.toHaveBeenCalled();
  });

  // SCRUM-98/AC5 replaced SCRUM-38's single approved venue with every venue booking of the event (approved ones included)
  it("SCRUM-38/AC4 38-S4, SCRUM-98/AC5 98-S24: shows every venue booking of the event under it", async () => {
    getEvent.mockResolvedValue({ event: { id: "evt-1", name: "Tech Summit", status: "approved", canChangeStatus: true } });
    const booking = (id: string, venueName: string, status: string) => ({
      id, eventId: "evt-1", eventName: "Tech Summit", venueId: id, venueName, date: "2026-11-14", startTime: "09:00", endTime: "17:00",
      status, decidedAt: null, submittedAt: "2026-10-01T00:00:00.000Z", rejectionReason: null, expectedAttendance: 50,
      venueRequirements: null, exceedsCapacity: false, flags: [],
    });
    getEventVenueBookings.mockResolvedValue([booking("b-1", "Orchid Hall", "APPROVED"), booking("b-2", "Lotus Room", "PENDING")]);

    await open("evt-1", "venues");

    expect(getEventVenueBookings).toHaveBeenCalledWith("evt-1");
    expect(screen.getByRole("heading", { name: "Venue bookings" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Orchid Hall" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Lotus Room" })).toBeTruthy();
  });

  it("SCRUM-38/AC4 38-S4, SCRUM-98/AC6 98-S27: shows no venue section to a viewer who may not see it", async () => {
    getEvent.mockResolvedValue({ event: { id: "evt-1", name: "Tech Summit", status: "approved", canChangeStatus: false } });

    await open("evt-1", "venues");

    expect(screen.getByText("This is not available to you for this event.")).toBeTruthy();
  });

  // SCRUM-102: while the event can still have venues, its pending and approved venue bookings can be changed or cancelled;
  // the cancel confirmation lists the equipment that the event page already loaded for that venue booking
  it.each([
    ["approved", true],
    ["confirmed", false],
  ])("SCRUM-102/AC1, AC2 102-S26: a %s event offers Change and Cancel: %s", async (status, offered) => {
    getEvent.mockResolvedValue({ event: { id: "evt-1", name: "Tech Summit", status, canChangeStatus: true } });
    getEventVenueBookings.mockResolvedValue([
      {
        id: "b-1", eventId: "evt-1", eventName: "Tech Summit", venueId: "v-1", venueName: "Orchid Hall", date: "2026-11-14", startTime: "09:00",
        endTime: "17:00", status: "PENDING", decidedAt: null, submittedAt: "2026-10-01T00:00:00.000Z", rejectionReason: null, cancellationReason: null,
        expectedAttendance: 50, venueRequirements: null, exceedsCapacity: false, flags: [],
      },
    ]);
    getEventEquipmentRequests.mockResolvedValue({
      requests: [{ id: "e-1", equipment: "AV: Projector Unit", quantity: 2, venueName: "Orchid Hall", venueBookingId: "b-1", notes: null, status: "ARRANGED", statusLabel: "Arranged", releasedReason: null }],
      canCreate: false,
    });

    await open("evt-1", "venues");

    expect(!!screen.queryByRole("link", { name: "Change the Orchid Hall venue booking" })).toBe(offered);
    expect(!!screen.queryByRole("button", { name: "Cancel the Orchid Hall venue booking" })).toBe(offered);
    if (offered) {
      fireEvent.click(screen.getByRole("button", { name: "Cancel the Orchid Hall venue booking" }));
      expect(screen.getByRole("alertdialog").textContent).toContain("2 × AV: Projector Unit (Arranged)");
    }
  });
});

describe("SCRUM-44 — review outcome on the event page", () => {
  const organiserView = (status: string) => ({
    event: { id: "evt-1", name: "Tech Summit", status, canChangeStatus: false, canReview: false, point_of_contact_name: "Rachel Tan" },
  });

  beforeEach(() => {
    getEventVenueBookings.mockReset().mockResolvedValue(null);
    getEventOutcome.mockReset().mockResolvedValue(null);
    stubEventService();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("AC2, AC3: shows the organiser a rejection and its reason, first after the status", async () => {
    getEvent.mockResolvedValue(organiserView("rejected"));
    getEventOutcome.mockResolvedValue({ outcome: "rejected", decided_at: "2026-09-02T03:00:00Z", reason: "Venue too small.", decided_by_name: "Rachel Tan" });

    await open("evt-1");

    expect(getEventOutcome).toHaveBeenCalledWith("evt-1");
    expect(screen.getAllByRole("heading", { level: 2 })[0].textContent).toBe("Review outcome");
    expect(screen.getByText("Venue too small.")).toBeTruthy();
  });

  it.each(["submitted", "under_review"])("AC5: tells the organiser a %s request is still being reviewed", async (status) => {
    getEvent.mockResolvedValue(organiserView(status));

    await open("evt-1");

    expect(screen.getByRole("heading", { name: "Review outcome" })).toBeTruthy();
    expect(screen.getByText(/still being reviewed/)).toBeTruthy();
  });

  it.each(["draft", "returned", "cancelled"])("AC5: says nothing about review for a %s request with no decision", async (status) => {
    getEvent.mockResolvedValue(organiserView(status));

    await open("evt-1");

    expect(screen.queryByRole("heading", { name: "Review outcome" })).toBeNull();
  });

  it("leaves the pending note out for the assigned coordinator, who has the Decision actions instead", async () => {
    getEvent.mockResolvedValue({ event: { ...organiserView("submitted").event, canChangeStatus: true, canReview: true } });

    await open("evt-1");

    expect(screen.queryByText(/still being reviewed/)).toBeNull();
    expect(screen.getByRole("heading", { name: "Decision" })).toBeTruthy();
  });

  it("AC6: loads no outcome when the event itself can't be shown", async () => {
    getEvent.mockResolvedValue({ error: "Event not found." });

    await open("evt-1");

    expect(getEventOutcome).not.toHaveBeenCalled();
  });
});

// ----------------------------------------------------------------------------
// SCRUM-111 editing the event's details from its page
// ----------------------------------------------------------------------------

describe("SCRUM-111 the event page's Edit button, saved message and change history (111-S13, 111-S15 to 111-S17)", () => {
  beforeEach(() => {
    getEventVenueBookings.mockReset().mockResolvedValue(null);
    getEventOutcome.mockReset().mockResolvedValue(null);
    getEventEquipmentRequests.mockReset().mockResolvedValue(null);
    getEventChangeHistory.mockReset().mockResolvedValue(null);
    stubEventService();
  });
  afterEach(() => vi.unstubAllGlobals());

  const withEvent = (canEdit: boolean) =>
    getEvent.mockResolvedValue({ event: { id: "evt-1", name: "Tech Summit", status: "planning", canChangeStatus: canEdit, canReview: false, canEdit } });

  // event-service says whether this viewer may edit (the assigned coordinator, while the event is not finished)
  it.each([
    [true, true],
    [false, false],
  ])("111-S16, S17 canEdit %s: the Edit event details link is shown: %s", async (canEdit, shown) => {
    withEvent(canEdit);

    await open("evt-1");

    const link = screen.queryByRole("link", { name: "Edit event details" });
    expect(!!link).toBe(shown);
    if (link) expect(link.getAttribute("href")).toBe("/events/evt-1/edit");
  });

  it("111-S15 back from the edit form, the page says the details were saved", async () => {
    withEvent(true);

    render(await EventPage({ params: Promise.resolve({ id: "evt-1" }), searchParams: Promise.resolve({ saved: "1" }) }));

    expect(screen.getAllByRole("status").some((el) => el.textContent === "Event details saved.")).toBe(true); // the page has other live regions too
  });

  it("111-S15 without it, no saved message", async () => {
    withEvent(true);

    await open("evt-1");

    expect(screen.queryByText("Event details saved.")).toBeNull();
  });

  it("111-S13 shows the change history it loads for this event", async () => {
    withEvent(true);
    getEventChangeHistory.mockResolvedValue([
      { id: "h-1", changedAt: "2099-10-02T03:00:00+00:00", changedBy: "Rachel Tan", important: false, changes: [{ field: "name", label: "Event name", from: "Summit", to: "Tech Summit" }] },
    ]);

    await open("evt-1", "changes");

    expect(getEventChangeHistory).toHaveBeenCalledWith("evt-1");
    expect(screen.getByRole("heading", { name: "Change history" })).toBeTruthy();
    expect(screen.getByText(/Summit → Tech Summit/)).toBeTruthy();
  });
});
// end of SCRUM-111

// SCRUM-67/AC1 (docs/specs/review-change-request.md)
describe("SCRUM-67/AC1 the event page tells the assigned coordinator a change request awaits review (67-S1)", () => {
  it("67-S1: the assigned coordinator sees the notice and a Review link; another coordinator sees no list", async () => {
    getEvent.mockResolvedValue({ event: { id: "evt-1", name: "Tech Summit", status: "planning", canChangeStatus: true } });
    getChangeRequests.mockResolvedValue([
      { id: "cr-1", change_description: "Changed: expected attendance", proposed_changes: null, status: "pending", requested_at: "2099-10-01T00:00:00Z", review_notes: null },
    ]);

    await open("evt-1", "changes");

    expect(getChangeRequests).toHaveBeenCalledWith("evt-1");
    expect(screen.getAllByRole("status").some((el) => el.textContent === "A change request is awaiting your review.")).toBe(true);
    expect(screen.getByRole("link", { name: "Review" }).getAttribute("href")).toBe("/change-requests/cr-1");

    getChangeRequests.mockClear();
    getEvent.mockResolvedValue({ event: { id: "evt-1", name: "Tech Summit", status: "planning", canChangeStatus: false } });
    cleanup();
    await open("evt-1", "changes");
    expect(getChangeRequests).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Change requests" })).toBeNull();
  });
});


describe("SCRUM-100/AC7 the event page shows the Safety Officer's requested changes", () => {
  beforeEach(() => {
    getEventVenueBookings.mockReset().mockResolvedValue(null);
    getEventOutcome.mockReset().mockResolvedValue(null);
    getEventEquipmentRequests.mockReset().mockResolvedValue(null);
    stubEventService();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("SCRUM-100/AC7 shows the requested changes it loads for this event", async () => {
    getEvent.mockResolvedValue({ event: { id: "evt-1", name: "Tech Summit", status: "planning", canChangeStatus: true } });
    getEventSafetyDecisions.mockResolvedValue([
      { decision: "changes_requested", reason: "Move the stage clear of fire exit B", officer_name: "Farah Ismail", decided_at: "2031-06-01T02:00:00Z" },
    ]);

    await open("evt-1", "safety");

    expect(getEventSafetyDecisions).toHaveBeenCalledWith("evt-1");
    expect(screen.getByRole("heading", { name: "Safety check" })).toBeTruthy();
    expect(screen.getByText("Move the stage clear of fire exit B")).toBeTruthy();
  });
});
