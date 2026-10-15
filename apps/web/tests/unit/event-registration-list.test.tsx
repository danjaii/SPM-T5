// this test file checks the registration information page that organisers and coordinators see for one event

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventRegistrationList } from "@/components/EventRegistrationList";
import type { EventRegistration } from "@/lib/eventRegistration";

// ---------------------------------------------------------------------------
// SCRUM-83 — The event's registrations, for its organiser and coordinator
// ---------------------------------------------------------------------------
describe("SCRUM-83 — Event registration list", () => {
  // AC15: the new registration appears on the registration information page seen by organisers and coordinators,
  // with the details the attendee submitted and its status
  it("SCRUM-83/AC15 lists each registration's name, email, contact number and status", () => {
    render(
      <EventRegistrationList
        registrations={[
          {
            id: "reg-1",
            status: "pending",
            registered_at: "2026-10-01T02:00:00Z",
            name: "Alicia Fernandez",
            email: "alicia.fernandez@example.com",
            phone: "+65 9123 4567",
          },
        ]}
      />,
    );

    const [row] = screen.getAllByRole("row").slice(1); // after the header row
    expect(within(row).getByText("Alicia Fernandez")).toBeTruthy();
    expect(within(row).getByText("alicia.fernandez@example.com")).toBeTruthy();
    expect(within(row).getByText("+65 9123 4567")).toBeTruthy();
    expect(within(row).getByText("Pending")).toBeTruthy();
  });

  // AC15: before anyone registers, the page says so rather than showing an empty table
  it("SCRUM-83/AC15 says nobody has registered yet when the list is empty", () => {
    render(<EventRegistrationList registrations={[]} />);

    expect(screen.getByText("Nobody has registered for this event yet.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
  // end of AC15
});
// end of SCRUM-83

/** One registration for the list; a test changes only what it is about. */
const aRegistration = (overrides: Partial<EventRegistration> = {}): EventRegistration => ({
  id: "reg-1",
  status: "pending",
  registered_at: "2026-10-01T02:00:00Z",
  name: "Alicia Fernandez",
  email: "alicia.fernandez@example.com",
  phone: "+65 9123 4567",
  ...overrides,
});

// ---------------------------------------------------------------------------
// SCRUM-74 — Viewing the registrations of an event I manage
// ---------------------------------------------------------------------------
describe("SCRUM-74 — Event registration list", () => {
  // AC5: each row shows when the attendee registered: the date and the time, in Singapore time
  it("SCRUM-74/AC5 shows the registration date and time", () => {
    render(<EventRegistrationList registrations={[aRegistration({ registered_at: "2026-10-01T02:00:00Z" })]} />);

    const [row] = screen.getAllByRole("row").slice(1); // after the header row
    expect(within(row).getByText("1 Oct 2026, 10:00 am")).toBeTruthy();
  });
  // end of AC5

  /** `count` registrations, each with its own id. */
  const registrations = (count: number) =>
    Array.from({ length: count }, (_, i) => aRegistration({ id: `reg-${i + 1}` }));

  // AC10: a list longer than 15 rows scrolls inside its box, rather than stretching the page
  it("SCRUM-74/AC10 makes a list of 16 registrations scrollable", () => {
    render(<EventRegistrationList registrations={registrations(16)} />);

    expect(screen.getByRole("table").parentElement?.classList.contains("table-wrap--scroll")).toBe(true);
  });

  // AC10: 15 rows or fewer show in full, with no scrolling
  it("SCRUM-74/AC10 shows a list of 15 registrations in full, without scrolling", () => {
    render(<EventRegistrationList registrations={registrations(15)} />);

    expect(screen.getByRole("table").parentElement?.classList.contains("table-wrap--scroll")).toBe(false);
  });
  // end of AC10

  // AC9: an event with no registrations says so, rather than showing an empty table
  it("SCRUM-74/AC9 shows a message when the event has no registrations", () => {
    render(<EventRegistrationList registrations={[]} />);

    expect(screen.getByText("Nobody has registered for this event yet.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
  // end of AC9
});
// end of SCRUM-74
