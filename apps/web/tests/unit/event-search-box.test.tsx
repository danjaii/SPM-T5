import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventSearch } from "@/components/EventSearch";
import type { UpcomingEvent } from "@/lib/getUpcomingEvents";

// ----------------------------------------------------------------------------
// Test setup: three upcoming events (docs/specs/event-search.md)
// ----------------------------------------------------------------------------

const anEvent = (overrides: Partial<UpcomingEvent> = {}): UpcomingEvent => ({
  id: "evt-1",
  name: "Pacific Rim Gala Dinner",
  start_at: "2026-12-12T10:30:00Z",
  end_at: "2026-12-12T14:30:00Z",
  venue: { name: "Riverside Grand Ballroom", address: "Jurong Gateway Road" },
  availability: "open",
  my_registration: null,
  status: "confirmed",
  organisation: "Pacific Rim Trade Association",
  category: "Networking Event",
  coordinator: "Rachel Tan",
  available_slots: 40,
  can_register: true,
  ...overrides,
});

const events = [
  anEvent(),
  anEvent({
    id: "evt-2",
    name: "TechConnect DevOps Workshop",
    start_at: "2026-10-15T01:00:00Z",
    venue: { name: "Marina Bayview Hall B", address: "Marina Way" },
    organisation: "TechConnect Pte Ltd",
    category: "Workshop",
    coordinator: "Marcus Lim",
    available_slots: 5,
    can_register: true,
  }),
  anEvent({
    id: "evt-3",
    name: "Meridian Capital Investor Day",
    start_at: "2026-11-05T02:00:00Z",
    venue: { name: null, address: null },
    organisation: "Meridian Capital",
    category: "Seminar",
    coordinator: "Marcus Lim",
    available_slots: null,
    can_register: true,
  }),
];

const searchBox = () => screen.getByRole("searchbox", { name: "Search events" });
const type = (text: string) => fireEvent.change(searchBox(), { target: { value: text } });
const shownNames = () => screen.queryAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);

// end of test setup

// ----------------------------------------------------------------------------
// SCRUM-9 the attendee's List of events, with its search box
// ----------------------------------------------------------------------------

describe("SCRUM-9/AC1 event search box", () => {
  // The cards narrow while the person types, with no button to press.
  it("9-S18: narrows the cards as the person types, and shows them all again when the box is empty", () => {
    render(<EventSearch events={events} />);
    expect(shownNames()).toEqual(["Pacific Rim Gala Dinner", "TechConnect DevOps Workshop", "Meridian Capital Investor Day"]);

    type("marcus"); // the coordinator of two events
    expect(shownNames()).toEqual(["TechConnect DevOps Workshop", "Meridian Capital Investor Day"]);

    type("marcus work"); // narrower still
    expect(shownNames()).toEqual(["TechConnect DevOps Workshop"]);

    type("");
    expect(shownNames()).toHaveLength(3);
  });

  it("9-S18: there is no Search button", () => {
    render(<EventSearch events={events} />);
    type("gala");

    expect(screen.queryByRole("button", { name: "Search" })).toBeNull(); // only the clear (x) button is there, named "Clear search"
  });

  // The × appears only while something is typed.
  it("9-S19: shows the clear button only while something is typed", () => {
    render(<EventSearch events={events} />);
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();

    type("gala");
    expect(screen.getByRole("button", { name: "Clear search" })).toBeTruthy();

    type("   "); // only spaces is not "something typed" for narrowing, but the box is not empty, so the button stays
    expect(screen.getByRole("button", { name: "Clear search" })).toBeTruthy();

    type("");
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });

  // Pressing the × empties the box, shows every event again, and puts the cursor back in the box.
  it("9-S20: the clear button empties the box and shows every event again", () => {
    render(<EventSearch events={events} />);
    type("gala");
    expect(shownNames()).toEqual(["Pacific Rim Gala Dinner"]);

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect((searchBox() as HTMLInputElement).value).toBe("");
    expect(shownNames()).toHaveLength(3);
    expect(document.activeElement).toBe(searchBox());
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });

  // Pressing Escape in the box does the same as the ×.
  it("9-S21: Escape empties the box and shows every event again", () => {
    render(<EventSearch events={events} />);
    type("gala");

    fireEvent.keyDown(searchBox(), { key: "Escape" });

    expect((searchBox() as HTMLInputElement).value).toBe("");
    expect(shownNames()).toHaveLength(3);
  });

  it("9-S21: other keys do not empty the box", () => {
    render(<EventSearch events={events} />);
    type("gala");

    fireEvent.keyDown(searchBox(), { key: "a" });

    expect((searchBox() as HTMLInputElement).value).toBe("gala");
  });
  // end of typing, clearing

  // The search box is the first thing on the list, above the cards, and screen readers can name it.
  it("9-S24: the search box comes before the cards, and has a name for screen readers", () => {
    render(<EventSearch events={events} />);

    const firstCard = screen.getAllByRole("article")[0];
    expect(searchBox().compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(searchBox().getAttribute("placeholder")).toMatch(/name.*organisation.*date.*venue.*status.*category.*coordinator/i);
  });
  // end of position
});

describe("SCRUM-9/AC3 event search: no matches", () => {
  // Events exist, but none match: a clear message that says what was typed.
  it("9-S22: says no events match what was typed, and shows no cards", () => {
    render(<EventSearch events={events} />);

    type("zebra");

    expect(screen.getByText('No events match "zebra"')).toBeTruthy();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.queryByText("No upcoming events")).toBeNull();
  });

  it("9-S22: the message shows what was typed without the spaces around it", () => {
    render(<EventSearch events={events} />);

    type("  zebra  ");

    expect(screen.getByText('No events match "zebra"')).toBeTruthy();
  });

  it("9-S22: the message goes away when the search matches again", () => {
    render(<EventSearch events={events} />);
    type("zebra");

    type("gala");

    expect(screen.queryByText(/No events match/)).toBeNull();
    expect(shownNames()).toEqual(["Pacific Rim Gala Dinner"]);
  });

  // With no upcoming events at all, the page keeps its own message, and there is nothing to search.
  it("9-S23: with no upcoming events at all, says 'No upcoming events' and not the no-match message", () => {
    render(<EventSearch events={[]} />);

    expect(screen.getByText("No upcoming events")).toBeTruthy();
    expect(screen.queryByText(/No events match/)).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });
  // end of no matches
});

describe("SCRUM-9/AC2 event search: the cards that are shown", () => {
  // The cards that stay are the normal cards, with the date, venue and slots.
  it("9-S18: a card that stays still shows its date, venue and available slots", () => {
    render(<EventSearch events={events} />);

    type("devops");

    const card = screen.getByRole("article");
    expect(within(card).getByText("TechConnect DevOps Workshop")).toBeTruthy();
    expect(within(card).getByText(/Marina Bayview Hall B, Marina Way/)).toBeTruthy();
    expect(within(card).getByText("5 slots left")).toBeTruthy();
  });
  // end of cards
});
// end of SCRUM-9
