// this test file checks the attendee's "My registrations" page (/registrations)

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Pretend loading helper (tested in event-registration-server.test.ts), so this test is only about the page itself
const { getMyRegistrations } = vi.hoisted(() => ({ getMyRegistrations: vi.fn() }));
vi.mock("@/lib/eventRegistrationServer", () => ({ getMyRegistrations }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

import MyRegistrationsPage from "@/app/registrations/page";

// ---------------------------------------------------------------------------
// SCRUM-83 — The "My registrations" page
// ---------------------------------------------------------------------------
describe("SCRUM-83 — My registrations page", () => {
  // AC15: the attendee's registrations appear on their "My registrations" page
  it("SCRUM-83/AC15 shows the attendee's registrations under a My registrations heading", async () => {
    getMyRegistrations.mockResolvedValue({
      registrations: [
        {
          id: "reg-1",
          status: "pending",
          registered_at: "2026-10-01T02:00:00Z",
          event: { id: "evt-1", name: "Tech Summit", start_at: "2026-12-12T11:00:00Z", end_at: null },
        },
      ],
    });

    render(await MyRegistrationsPage());

    expect(screen.getByRole("heading", { name: "My registrations" })).toBeTruthy();
    expect(screen.getByText("Tech Summit")).toBeTruthy();
    expect(screen.getByText("Pending")).toBeTruthy();
  });

  // AC15: a list that couldn't load says so, rather than claiming there are no registrations
  it("SCRUM-83/AC15 shows the loader's error instead of an empty list", async () => {
    getMyRegistrations.mockResolvedValue({ error: "We couldn't load your registrations. Please try again." });

    render(await MyRegistrationsPage());

    expect(screen.getByRole("alert").textContent).toBe("We couldn't load your registrations. Please try again.");
    expect(screen.queryByText("You haven't registered for any events yet.")).toBeNull();
  });
  // end of AC15
});
// end of SCRUM-83
