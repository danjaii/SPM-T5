// this test file checks the attendee's "My registrations" list

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MyRegistrationList } from "@/components/MyRegistrationList";
import type { MyRegistration } from "@/lib/eventRegistration";

/** One registration as event-service's GET /events/my-registrations sends it. */
function aRegistration(overrides: Partial<MyRegistration> = {}): MyRegistration {
  return {
    id: "reg-1",
    status: "pending",
    registered_at: "2026-10-01T02:00:00Z",
    event: {
      id: "evt-1",
      name: "Tech Summit",
      start_at: "2026-12-12T11:00:00Z",
      end_at: "2026-12-12T13:00:00Z",
      venue: { name: "Orchid Hall", address: "Level 3, East Wing" },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SCRUM-83 — The attendee's "My registrations" page
// ---------------------------------------------------------------------------
describe("SCRUM-83 — My registrations", () => {
  // AC15: the new registration appears on "My registrations", with its event and status;
  // AC6: earlier (e.g. Withdrawn) registrations stay in the history
  it("SCRUM-83/AC15 lists each registration with its event, date and status, earlier ones included", () => {
    render(
      <MyRegistrationList
        registrations={[
          aRegistration({ id: "reg-new", status: "pending" }),
          aRegistration({ id: "reg-old", status: "withdrawn", registered_at: "2026-09-01T02:00:00Z" }),
        ]}
      />,
    );

    const rows = screen.getAllByRole("row").slice(1); // after the header row
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Tech Summit")).toBeTruthy();
    expect(within(rows[0]).getByText("Sat, 12 Dec 2026, 7:00 PM – 9:00 PM")).toBeTruthy();
    expect(within(rows[0]).getByText("Pending")).toBeTruthy();
    expect(within(rows[1]).getByText("Withdrawn")).toBeTruthy();
  });

  // AC15: before the first registration, the page says so rather than showing an empty table
  it("SCRUM-83/AC15 says there are no registrations yet when the list is empty", () => {
    render(<MyRegistrationList registrations={[]} />);

    // SCRUM-72/AC5 changed the wording
    expect(screen.getByText("You have not registered for an event")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
  // end of AC15
});
// end of SCRUM-83

// ---------------------------------------------------------------------------
// SCRUM-72 — The attendee views the status of their registrations
// ---------------------------------------------------------------------------
describe("SCRUM-72 — View the status of my registrations", () => {
  // AC3: each registration shows its status as a label in that status's colour. jsdom doesn't load the CSS,
  // so the test checks each badge has its status's colour class; globals.css gives each class its colour.
  // Withdrawn isn't in the AC, but SCRUM-83/AC6 keeps it in the history, so it gets a (grey) colour too.
  it("SCRUM-72/AC3 shows each status as a label in its own colour", () => {
    render(
      <MyRegistrationList
        registrations={[
          aRegistration({ id: "reg-p", status: "pending" }),
          aRegistration({ id: "reg-c", status: "confirmed" }),
          aRegistration({ id: "reg-r", status: "rejected" }),
          aRegistration({ id: "reg-w", status: "withdrawn" }),
        ]}
      />,
    );

    expect(screen.getByText("Pending").className).toContain("status-badge--pending");
    expect(screen.getByText("Confirmed").className).toContain("status-badge--confirmed");
    expect(screen.getByText("Rejected").className).toContain("status-badge--rejected");
    expect(screen.getByText("Withdrawn").className).toContain("status-badge--withdrawn");
  });
  // end of AC3

  // AC4: each registration shows its event's name, date, time and location; the location is the venue's name
  // and address, worded as on the List of events (SCRUM-71/AC3)
  it("SCRUM-72/AC4 shows each registration's event name, date and time, and location", () => {
    render(
      <MyRegistrationList
        registrations={[
          aRegistration({
            event: {
              id: "evt-1",
              name: "Tech Summit",
              start_at: "2026-12-12T11:00:00Z",
              end_at: "2026-12-12T13:00:00Z",
              venue: { name: "Orchid Hall", address: "Level 3, East Wing" },
            },
          }),
        ]}
      />,
    );

    const row = screen.getAllByRole("row")[1]; // after the header row
    expect(within(row).getByText("Tech Summit")).toBeTruthy();
    expect(within(row).getByText("Sat, 12 Dec 2026, 7:00 PM – 9:00 PM")).toBeTruthy();
    expect(within(row).getByText("Orchid Hall, Level 3, East Wing")).toBeTruthy();
  });

  // AC4: an event whose venue isn't known yet says so, worded as on the List of events (SCRUM-71/AC3)
  it("SCRUM-72/AC4 says the venue is to be confirmed when the location isn't known", () => {
    const registration = aRegistration();
    registration.event.venue = { name: null, address: null };

    render(<MyRegistrationList registrations={[registration]} />);

    const row = screen.getAllByRole("row")[1]; // after the header row
    expect(within(row).getByText("Venue to be confirmed")).toBeTruthy();
  });
  // end of AC4

  // AC5: with no registration for an upcoming event, the page says so (event-service sends only upcoming ones, AC1)
  it("SCRUM-72/AC5 says the attendee has not registered for an event when there are none", () => {
    render(<MyRegistrationList registrations={[]} />);

    expect(screen.getByText("You have not registered for an event")).toBeTruthy();
  });
  // end of AC5
});
// end of SCRUM-72
