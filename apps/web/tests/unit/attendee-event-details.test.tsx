// this test file checks that an attendee can open an event from Browse events and read its details

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// the Withdraw button in My registrations reads the router
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
import { EventDetails } from "@/components/EventDetails";
import { MyRegistrationList } from "@/components/MyRegistrationList";
import { UpcomingEventList } from "@/components/UpcomingEventList";
import type { UpcomingEvent } from "@/lib/getUpcomingEvents";

function anEvent(overrides: Partial<UpcomingEvent> = {}): UpcomingEvent {
  return {
    id: "evt-1",
    name: "Tech Summit",
    start_at: "2026-12-12T11:00:00Z",
    end_at: "2026-12-12T13:00:00Z",
    venue: { name: "Orchid Hall", address: "Level 3, East Wing" },
    availability: "open",
    my_registration: null,
    status: "confirmed",
    organisation: "TechConnect Pte Ltd",
    category: "Conference",
    coordinator: "Rachel Tan",
    available_slots: 40,
    can_register: (overrides.availability ?? "open") === "open",
    ...overrides,
  };
}

describe("SCRUM-139 — attendee event details", () => {
  it("SCRUM-139/AC13 links an event's name on Browse events to its details", () => {
    render(<UpcomingEventList events={[anEvent({ id: "evt-42" })]} />);

    expect(screen.getByRole("link", { name: "Tech Summit" }).getAttribute("href")).toBe("/dashboard/attendee/evt-42");
  });

  it("SCRUM-139/AC14 links an event's name under My registrations to its details", () => {
    render(
      <MyRegistrationList
        registrations={[
          {
            id: "reg-1",
            status: "confirmed",
            registered_at: "2026-10-01T02:00:00Z",
            can_withdraw: false,
            event: { id: "evt-7", name: "Design Week", start_at: "2026-12-12T11:00:00Z", end_at: null, venue: { name: null, address: null } },
          },
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: "Design Week" }).getAttribute("href")).toBe("/dashboard/attendee/evt-7");
  });

  it("SCRUM-139/AC13 keeps Register as its own link to the registration form", () => {
    render(<UpcomingEventList events={[anEvent({ id: "evt-42" })]} />);

    expect(screen.getByRole("link", { name: "Register" }).getAttribute("href")).toBe("/events/evt-42/register");
  });

  it("SCRUM-139/AC13 shows when, where, places, category, organisation and coordinator", () => {
    render(<EventDetails event={anEvent()} />);

    expect(screen.getByRole("heading", { name: "Tech Summit" })).toBeTruthy();
    const facts = document.querySelector("dl") as HTMLElement;
    expect(within(facts).getByText("Orchid Hall, Level 3, East Wing")).toBeTruthy();
    expect(within(facts).getByText("40 slots left")).toBeTruthy();
    expect(within(facts).getByText("Conference")).toBeTruthy();
    expect(within(facts).getByText("TechConnect Pte Ltd")).toBeTruthy();
    expect(within(facts).getByText("Rachel Tan")).toBeTruthy();
  });

  it("SCRUM-139/AC13 leaves out the facts an event does not have and says when the venue is not confirmed", () => {
    render(<EventDetails event={anEvent({ venue: { name: null, address: null }, organisation: null, category: null, coordinator: null })} />);

    expect(screen.getByText("Venue to be confirmed")).toBeTruthy();
    expect(screen.queryByText("Organised by")).toBeNull();
    expect(screen.queryByText("Category")).toBeNull();
    expect(screen.queryByText("Event coordinator")).toBeNull();
  });

  it("SCRUM-139/AC13 offers Register on an open event and the attendee's own status once registered", () => {
    const { rerender } = render(<EventDetails event={anEvent({ id: "evt-9" })} />);
    expect(screen.getByRole("link", { name: "Register" }).getAttribute("href")).toBe("/events/evt-9/register");

    rerender(<EventDetails event={anEvent({ my_registration: "confirmed" })} />);
    expect(screen.queryByRole("link", { name: "Register" })).toBeNull();
    expect(screen.getByText("Your registration:")).toBeTruthy();
  });

  // SCRUM-169/AC2 replaces SCRUM-139/AC13's hidden button: registering on a full event is saved as Pending
  it("SCRUM-169/AC2 offers Register on a full event and says the organiser will decide", () => {
    render(<EventDetails event={anEvent({ availability: "full", available_slots: 0, can_register: true })} />);

    expect(screen.getByText("Event Full")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Register" })).toBeTruthy();
    expect(screen.getByText("This event is full. You can still register, and the organiser will decide.")).toBeTruthy();
  });

  it("SCRUM-139/AC13 says why there is no Register button when registration isn't available", () => {
    render(<EventDetails event={anEvent({ availability: "full", available_slots: 0, can_register: false })} />);

    expect(screen.getByText("Event Full")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Register" })).toBeNull();
    expect(screen.getByText("Registration is not available for this event.")).toBeTruthy();
  });
});
