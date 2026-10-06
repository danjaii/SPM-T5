// this test file checks the registration information page that organisers and coordinators see for one event

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventRegistrationList } from "@/components/EventRegistrationList";

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
