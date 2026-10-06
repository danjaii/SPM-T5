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
    event: { id: "evt-1", name: "Tech Summit", start_at: "2026-12-12T11:00:00Z", end_at: "2026-12-12T13:00:00Z" },
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

    expect(screen.getByText("You haven't registered for any events yet.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
  // end of AC15
});
// end of SCRUM-83
