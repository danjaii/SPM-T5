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
});
// end of SCRUM-71
