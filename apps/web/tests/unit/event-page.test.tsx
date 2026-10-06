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
  beforeEach(() => getApprovedVenueBooking.mockResolvedValue(null));

  it("shows the event it was asked for", async () => {
    getEvent.mockResolvedValue({ event: { id: "evt-1", name: "Tech Summit", status: "approved", canChangeStatus: false } });

    await open("evt-1");

    expect(getEvent).toHaveBeenCalledWith("evt-1");
    expect(screen.getByRole("heading", { name: "Tech Summit" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /back to dashboard/i }).getAttribute("href")).toBe("/dashboard");
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
