// this test file checks the summary above an event's registrations: totals by status and slots remaining

import { describe, expect, it } from "vitest";
import { registrationSummary, type EventRegistration, type RegistrationStatus } from "@/lib/eventRegistration";

/** One registration with the given status; the other details don't matter to the summary. */
const aRegistration = (status: RegistrationStatus): EventRegistration => ({
  id: `reg-${Math.random()}`,
  status,
  registered_at: "2026-10-01T02:00:00Z",
  name: "Alicia Fernandez",
  email: "alicia.fernandez@example.com",
  phone: "+65 9123 4567",
});

// ---------------------------------------------------------------------------
// SCRUM-74 — Registration summary
// ---------------------------------------------------------------------------
describe("SCRUM-74 — Registration summary", () => {
  // AC6: the summary shows the total number of registrations, split by status
  it("SCRUM-74/AC6 counts the total and each status", () => {
    const summary = registrationSummary(
      [aRegistration("pending"), aRegistration("confirmed"), aRegistration("confirmed"), aRegistration("withdrawn")],
      100,
    );

    expect(summary.total).toBe(4);
    expect(summary.byStatus).toEqual({ pending: 1, confirmed: 2, rejected: 0, withdrawn: 1 });
  });
  // end of AC6

  // AC7: only confirmed registrations use a slot, so Pending, Rejected and Withdrawn ones leave it free
  it("SCRUM-74/AC7 counts only confirmed registrations against capacity", () => {
    const summary = registrationSummary(
      [aRegistration("confirmed"), aRegistration("confirmed"), aRegistration("pending"), aRegistration("withdrawn")],
      10,
    );

    expect(summary.slotsRemaining).toBe(8);
  });
  // end of AC7

  // AC6: an event with no capacity has no limit on slots, rather than a negative number left
  it("SCRUM-74/AC6 has no slots remaining figure when the event has no capacity", () => {
    const summary = registrationSummary([aRegistration("confirmed")], null);

    expect(summary.slotsRemaining).toBeNull();
  });
  // end of AC6
});
// end of SCRUM-74
