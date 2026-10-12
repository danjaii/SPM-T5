import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getEvent, getEventOutcome } = vi.hoisted(() => ({ getEvent: vi.fn(), getEventOutcome: vi.fn() }));
const { getApprovedVenueBooking } = vi.hoisted(() => ({ getApprovedVenueBooking: vi.fn() }));
vi.mock("@/lib/getEvent", () => ({ getEvent, getEventOutcome }));
vi.mock("@/lib/venueBookingsServer", () => ({ getApprovedVenueBooking }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

import EventPage from "@/app/events/[id]/page";

const open = async (id: string) => render(await EventPage({ params: Promise.resolve({ id }) }));

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
    getApprovedVenueBooking.mockReset().mockResolvedValue(null);
    getEventOutcome.mockReset().mockResolvedValue(null);
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

    await open("evt-1");

    expect(screen.getByRole("link", { name: "View registrations" }).getAttribute("href")).toBe("/events/evt-1/registrations");
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

    await open("evt-1");

    expect(screen.getByRole("heading", { name: "Coordinator" })).toBeTruthy();
    expect(screen.getByText("Alice Coord")).toBeTruthy();
  });

  it("SCRUM-23/AC2: reads top to bottom — details, coordinator, then the manual status change", async () => {
    getEvent.mockResolvedValue({
      event: { id: "evt-1", name: "Tech Summit", status: "submitted", canChangeStatus: true, canReview: false,
        point_of_contact_name: "Alice Coord", organiser_name: "Sam Tan" },
    });

    await open("evt-1");
    await screen.findByRole("heading", { name: "Comments" }); // SCRUM-25: loads from the browser

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Request details", "Coordinator", "Assignment history", "Comments", "Registrations", "Change status"]);
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

    expect(screen.getByText("Submitted", { selector: ".status-badge" })).toBeTruthy();
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
    expect(getApprovedVenueBooking).not.toHaveBeenCalled();
  });

  it("SCRUM-38/AC4 38-S4: shows the approved venue booking under the event", async () => {
    getEvent.mockResolvedValue({ event: { id: "evt-1", name: "Tech Summit", status: "approved", canChangeStatus: true } });
    getApprovedVenueBooking.mockResolvedValue({ venueName: "Orchid Hall", date: "2026-11-14", startTime: "09:00", endTime: "17:00" });

    await open("evt-1");

    expect(getApprovedVenueBooking).toHaveBeenCalledWith("evt-1");
    expect(screen.getByText("Orchid Hall")).toBeTruthy();
  });

  it("SCRUM-38/AC4 38-S4: shows no venue section when there is none", async () => {
    getEvent.mockResolvedValue({ event: { id: "evt-1", name: "Tech Summit", status: "approved", canChangeStatus: false } });

    await open("evt-1");

    expect(screen.queryByText("Orchid Hall")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Venue booking" })).toBeNull();
  });
});

describe("SCRUM-44 — review outcome on the event page", () => {
  const organiserView = (status: string) => ({
    event: { id: "evt-1", name: "Tech Summit", status, canChangeStatus: false, canReview: false, point_of_contact_name: "Rachel Tan" },
  });

  beforeEach(() => {
    getApprovedVenueBooking.mockReset().mockResolvedValue(null);
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
