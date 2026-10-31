// this test file checks what the attendee sees on each card in the List of events

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UpcomingEventList } from "@/components/UpcomingEventList";
import type { UpcomingEvent } from "@/lib/getUpcomingEvents";

/** One event as event-service sends it; tests override only what they care about. */
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

// ---------------------------------------------------------------------------
// SCRUM-71 — List of events (cards)
// ---------------------------------------------------------------------------
describe("SCRUM-71 — List of events cards", () => {
  // AC1: each upcoming event is shown as its own card, headed by the event name
  it("SCRUM-71/AC1 shows each event as a card with its name", () => {
    render(
      <UpcomingEventList
        events={[anEvent({ id: "evt-1", name: "Tech Summit" }), anEvent({ id: "evt-2", name: "Design Meetup" })]}
      />,
    );

    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByRole("heading", { name: "Tech Summit" })).toBeTruthy();
    expect(within(cards[1]).getByRole("heading", { name: "Design Meetup" })).toBeTruthy();
  });
  // end of AC1

  // AC3: the location shows both the venue's name and its address
  it("SCRUM-71/AC3 shows the venue name and address as the location", () => {
    render(<UpcomingEventList events={[anEvent({ venue: { name: "Orchid Hall", address: "Level 3, East Wing" } })]} />);

    expect(within(screen.getByRole("article")).getByText("Orchid Hall, Level 3, East Wing")).toBeTruthy();
  });

  // AC3: an event whose venue booking isn't agreed yet has no venue; say so instead of showing "null, null"
  it("SCRUM-71/AC3 says the venue is to be confirmed when it isn't known yet", () => {
    render(<UpcomingEventList events={[anEvent({ venue: { name: null, address: null } })]} />);

    const card = screen.getByRole("article");
    expect(within(card).getByText("Venue to be confirmed")).toBeTruthy();
    expect(within(card).queryByText(/null/)).toBeNull();
  });
  // end of AC3

  // AC4: date and time read like "Sat, 12 Dec 2026, 7:00 PM – 9:00 PM", in Singapore time (UTC+8)
  it("SCRUM-71/AC4 shows the date and time as 'Sat, 12 Dec 2026, 7:00 PM – 9:00 PM' in Singapore time", () => {
    // 11:00 and 13:00 UTC are 7 PM and 9 PM in Singapore
    render(<UpcomingEventList events={[anEvent({ start_at: "2026-12-12T11:00:00Z", end_at: "2026-12-12T13:00:00Z" })]} />);

    expect(within(screen.getByRole("article")).getByText("Sat, 12 Dec 2026, 7:00 PM – 9:00 PM")).toBeTruthy();
  });

  // AC4: the end time is optional on an event; without one, show the start only
  it("SCRUM-71/AC4 shows only the start when the event has no end time", () => {
    render(<UpcomingEventList events={[anEvent({ start_at: "2026-12-12T11:00:00Z", end_at: null })]} />);

    expect(within(screen.getByRole("article")).getByText("Sat, 12 Dec 2026, 7:00 PM")).toBeTruthy();
  });
  // end of AC4

  // AC7: the one label event-service picked is shown on the card; an open event has no label
  it("SCRUM-71/AC7 shows the Cancelled, Event Full or Registration Closed label", () => {
    render(
      <UpcomingEventList
        events={[
          anEvent({ id: "evt-cancelled", name: "Cancelled Gala", availability: "cancelled" }),
          anEvent({ id: "evt-full", name: "Full Workshop", availability: "full" }),
          anEvent({ id: "evt-closed", name: "Closed Forum", availability: "closed" }),
          anEvent({ id: "evt-open", name: "Open Meetup", availability: "open" }),
        ]}
      />,
    );

    const [cancelled, full, closed, open] = screen.getAllByRole("article");
    expect(within(cancelled).getByText("Cancelled")).toBeTruthy();
    expect(within(full).getByText("Event Full")).toBeTruthy();
    expect(within(closed).getByText("Registration Closed")).toBeTruthy();
    expect(within(open).queryByText(/Cancelled|Event Full|Registration Closed/)).toBeNull();
  });
  // end of AC7

  // AC8: an open event invites the attendee to register, linking to that event's registration form
  it("SCRUM-71/AC8 shows a Register button on an open event, linking to its registration form", () => {
    render(<UpcomingEventList events={[anEvent({ id: "evt-42", availability: "open" })]} />);

    const register = within(screen.getByRole("article")).getByRole("link", { name: "Register" });
    expect(register.getAttribute("href")).toBe("/events/evt-42/register");
  });
  // end of AC8

  // AC9: nobody can register for a cancelled, full or closed event, so there's no Register button to press
  it("SCRUM-71/AC9 has no Register button on cancelled, full or closed events", () => {
    render(
      <UpcomingEventList
        events={[
          anEvent({ id: "evt-cancelled", availability: "cancelled" }),
          anEvent({ id: "evt-full", availability: "full" }),
          anEvent({ id: "evt-closed", availability: "closed" }),
        ]}
      />,
    );

    for (const card of screen.getAllByRole("article")) {
      expect(within(card).queryByRole("link", { name: "Register" })).toBeNull();
    }
  });
  // end of AC9

  // ---------------------------------------------------------------------------
  // SCRUM-83 — Register for an event, from the cards
  // ---------------------------------------------------------------------------

  // SCRUM-83/AC1: the attendee can click "Register" on each event card, each leading to that event's form
  it("SCRUM-83/AC1 gives each open event card its own Register link", () => {
    render(
      <UpcomingEventList
        events={[anEvent({ id: "evt-1", name: "Tech Summit" }), anEvent({ id: "evt-2", name: "Design Meetup" })]}
      />,
    );

    const [first, second] = screen.getAllByRole("article");
    expect(within(first).getByRole("link", { name: "Register" }).getAttribute("href")).toBe("/events/evt-1/register");
    expect(within(second).getByRole("link", { name: "Register" }).getAttribute("href")).toBe("/events/evt-2/register");
  });

  // SCRUM-83/AC3: when registration has closed, Register is hidden and the attendee sees "Registration closed"
  // (the label's capitalisation comes from SCRUM-71/AC7, so it's matched without case)
  it("SCRUM-83/AC3 hides Register and says registration is closed on a closed event", () => {
    render(<UpcomingEventList events={[anEvent({ availability: "closed" })]} />);

    const card = screen.getByRole("article");
    expect(within(card).getByText(/registration closed/i)).toBeTruthy();
    expect(within(card).queryByRole("link", { name: "Register" })).toBeNull();
  });

  // SCRUM-169/AC2 replaces SCRUM-83/AC4's hidden button: a full event says so, and can still be registered for, as Pending
  it("SCRUM-169/AC2 says the event is full and still offers Register while its window is open", () => {
    render(<UpcomingEventList events={[anEvent({ availability: "full", can_register: true })]} />);

    const card = screen.getByRole("article");
    expect(within(card).getByText(/event full/i)).toBeTruthy();
    expect(within(card).getByRole("link", { name: "Register" })).toBeTruthy();
  });

  // SCRUM-169/AC2: "Event Full" outranks "Registration Closed", so a full event past its window still has no Register
  it("SCRUM-169/AC2 hides Register on a full event whose registration has closed", () => {
    render(<UpcomingEventList events={[anEvent({ availability: "full", can_register: false })]} />);

    expect(screen.queryByRole("link", { name: "Register" })).toBeNull();
  });

  // AC10: with an active registration, the card shows its status instead of the Register button
  it("SCRUM-71/AC10 shows the attendee's Confirmed or Pending registration instead of the Register button", () => {
    render(
      <UpcomingEventList
        events={[
          anEvent({ id: "evt-confirmed", my_registration: "confirmed" }),
          anEvent({ id: "evt-pending", my_registration: "pending" }),
        ]}
      />,
    );

    const [confirmed, pending] = screen.getAllByRole("article");
    expect(within(confirmed).getByText("Your registration:").textContent).toBe("Your registration:Confirmed");
    expect(within(pending).getByText("Your registration:").textContent).toBe("Your registration:Pending");
    expect(screen.queryByRole("link", { name: "Register" })).toBeNull();
  });
  // end of AC10

  // AC11: an empty list gets a friendly message, not an empty space
  it("SCRUM-71/AC11 shows 'No upcoming events' when there are none", () => {
    render(<UpcomingEventList events={[]} />);

    expect(screen.getByText("No upcoming events")).toBeTruthy();
    expect(screen.queryByRole("article")).toBeNull();
  });
  // end of AC11
});
// end of SCRUM-71

// ---------------------------------------------------------------------------
// SCRUM-9 — a card shows the available slots
// ---------------------------------------------------------------------------
describe("SCRUM-9/AC2 — a card shows the available slots", () => {
  // The card says how many places are left, in words that read naturally for one place, many places, none, and no limit.
  it.each([
    [12, "12 slots left"],
    [1, "1 slot left"],
    [0, "No slots left"],
    [null, "No limit"],
  ])("9-S17: shows %s available slots as '%s'", (slots, text) => {
    render(<UpcomingEventList events={[anEvent({ available_slots: slots })]} />);

    expect(screen.getByText(text)).toBeTruthy();
  });
  // end of slots
});
// end of SCRUM-9
