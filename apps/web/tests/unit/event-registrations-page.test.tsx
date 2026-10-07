// this test file checks the registration information page for one event (/events/<id>/registrations)

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Pretend loading helper (tested in event-registration-server.test.ts), so this test is only about the page itself
const { getEventRegistrations } = vi.hoisted(() => ({ getEventRegistrations: vi.fn() }));
vi.mock("@/lib/eventRegistrationServer", () => ({ getEventRegistrations }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

import EventRegistrationsPage from "@/app/events/[id]/registrations/page";

// ---------------------------------------------------------------------------
// SCRUM-83 — The registration information page seen by organisers and coordinators
// ---------------------------------------------------------------------------
describe("SCRUM-83 — Event registrations page", () => {
  // AC15: the new registration appears on the registration information page for the event in the address
  it("SCRUM-83/AC15 shows the registrations of the event in the address", async () => {
    getEventRegistrations.mockResolvedValue({
      registrations: [
        {
          id: "reg-1",
          status: "pending",
          registered_at: "2026-10-01T02:00:00Z",
          name: "Alicia Fernandez",
          email: "alicia.fernandez@example.com",
          phone: "+65 9123 4567",
        },
      ],
    });

    render(await EventRegistrationsPage({ params: Promise.resolve({ id: "evt-1" }) }));

    expect(getEventRegistrations).toHaveBeenCalledWith("evt-1");
    expect(screen.getByRole("heading", { name: "Registrations" })).toBeTruthy();
    expect(screen.getByText("Alicia Fernandez")).toBeTruthy();
  });

  // AC15: a list that couldn't load says so, rather than claiming nobody has registered
  it("SCRUM-83/AC15 shows the loader's error instead of an empty list", async () => {
    getEventRegistrations.mockResolvedValue({ error: "We couldn't load this event's registrations. Please try again." });

    render(await EventRegistrationsPage({ params: Promise.resolve({ id: "evt-1" }) }));

    expect(screen.getByRole("alert").textContent).toBe("We couldn't load this event's registrations. Please try again.");
    expect(screen.queryByText("Nobody has registered for this event yet.")).toBeNull();
  });
  // end of AC15
});
// end of SCRUM-83
