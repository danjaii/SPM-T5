// this test file checks the summary shown above an event's registrations

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RegistrationSummary } from "@/components/RegistrationSummary";
import type { EventRegistration, RegistrationStatus } from "@/lib/eventRegistration";

/** One registration with the given status; the other details don't matter to the summary. */
const aRegistration = (id: string, status: RegistrationStatus): EventRegistration => ({
  is_vip: false,
  id,
  status,
  registered_at: "2026-10-01T02:00:00Z",
  name: "Alicia Fernandez",
  email: "alicia.fernandez@example.com",
  phone: "+65 9123 4567",
});

/** The figure on the summary card headed `label`. */
const figure = (label: string) => {
  const list = screen.getByRole("list", { name: "Registration summary" });
  const card = within(list).getByText(label, { selector: "p" }).closest("li")!;
  return card.querySelectorAll("p")[1]?.textContent;
};

// ---------------------------------------------------------------------------
// SCRUM-74 — Registration summary
// ---------------------------------------------------------------------------
describe("SCRUM-74 — Registration summary panel", () => {
  // AC6: the summary shows total registrations, split by status
  it("SCRUM-74/AC6 shows the total and the number in each status", () => {
    render(
      <RegistrationSummary
        registrations={[
          aRegistration("reg-1", "pending"),
          aRegistration("reg-2", "confirmed"),
          aRegistration("reg-3", "confirmed"),
          aRegistration("reg-4", "withdrawn"),
        ]}
        capacity={100}
      />,
    );

    expect(figure("Total registrations")).toBe("4");
    expect(figure("Pending")).toBe("1");
    expect(figure("Confirmed")).toBe("2");
    expect(figure("Rejected")).toBe("0");
    expect(figure("Withdrawn")).toBe("1");
  });
  // end of AC6

  // AC6, AC7: slots remaining against capacity; only the Confirmed registrations use a slot
  it("SCRUM-74/AC7 shows slots remaining out of capacity, counting only confirmed registrations", () => {
    render(
      <RegistrationSummary
        registrations={[
          aRegistration("reg-1", "confirmed"),
          aRegistration("reg-2", "confirmed"),
          aRegistration("reg-3", "pending"),
        ]}
        capacity={10}
      />,
    );

    expect(figure("Slots remaining")).toBe("8 of 10");
  });
  // end of AC7

  // AC6: an event with no capacity has no limit on slots
  it("SCRUM-74/AC6 says there is no limit when the event has no capacity", () => {
    render(<RegistrationSummary registrations={[aRegistration("reg-1", "confirmed")]} capacity={null} />);

    expect(figure("Slots remaining")).toBe("No limit");
  });
  // end of AC6

  // SCRUM-139/AC4, AC15: one card for each figure, with the count against capacity. The figures about places (total, confirmed,
  // slots remaining) come first as one group, then the statuses that do not use a place.
  it("SCRUM-139/AC4,AC15 shows one card per figure and the confirmed count against capacity", () => {
    render(
      <RegistrationSummary
        registrations={[aRegistration("reg-1", "pending"), aRegistration("reg-2", "confirmed")]}
        capacity={20}
      />,
    );

    const list = screen.getByRole("list", { name: "Registration summary" });
    expect(within(list).getAllByRole("listitem").map((li) => li.querySelector("p")?.textContent)).toEqual([
      "Total registrations",
      "Confirmed",
      "Slots remaining",
      "Pending",
      "Rejected",
      "Withdrawn",
    ]);
    expect(figure("Confirmed")).toBe("1");
    expect(within(list).getByText("of 20 places")).toBeTruthy();
    expect(figure("Slots remaining")).toBe("19 of 20");
  });
  // end of AC4
});
// end of SCRUM-74
