import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getEvent } = vi.hoisted(() => ({ getEvent: vi.fn() }));
const { getApprovedVenueBooking } = vi.hoisted(() => ({ getApprovedVenueBooking: vi.fn() }));
vi.mock("@/lib/getEvent", () => ({ getEvent }));
vi.mock("@/lib/venueBookingsServer", () => ({ getApprovedVenueBooking }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ replace: vi.fn() }) }));

import EventPage from "@/app/events/[id]/page";

const open = async (id: string) => render(await EventPage({ params: Promise.resolve({ id }) }));

describe("Event status page route (/events/[id])", () => {
  beforeEach(() => getApprovedVenueBooking.mockReset().mockResolvedValue(null));

  it("shows the event it was asked for", async () => {
    getEvent.mockResolvedValue({ event: { id: "evt-1", name: "Tech Summit", status: "approved", canChangeStatus: false } });

    await open("evt-1");

    expect(getEvent).toHaveBeenCalledWith("evt-1");
    expect(screen.getByRole("heading", { name: "Tech Summit" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /back to dashboard/i }).getAttribute("href")).toBe("/dashboard");
  });

  it("shows event-service's message when the event can't be shown", async () => {
    getEvent.mockResolvedValue({ error: "Event not found." });

    await open("missing");

    expect(screen.getByRole("alert").textContent).toBe("Event not found.");
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
