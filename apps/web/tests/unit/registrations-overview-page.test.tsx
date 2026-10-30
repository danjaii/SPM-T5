// this test file checks the page where organisers and coordinators pick one of their events and see its registrations

import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Pretend loading helpers (tested in event-registration-server.test.ts), so this test is only about the page itself
const { getManagedEvents, getEventRegistrations } = vi.hoisted(() => ({
  getManagedEvents: vi.fn(),
  getEventRegistrations: vi.fn(),
}));
vi.mock("@/lib/eventRegistrationServer", () => ({ getManagedEvents, getEventRegistrations }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }) }));

import RegistrationsOverviewPage from "@/app/registrations-overview/page";

/** One of the caller's events, as GET /events/managed sends it. */
const TECH_SUMMIT = { id: "evt-1", name: "Tech Summit", status: "confirmed", start_at: "2026-11-20T01:00:00Z", registration_capacity: 10, can_decide: false };

/** Renders the page as if the address's query string were `query` (e.g. { event: "evt-1" }). */
const renderPage = async (query: { event?: string } = {}) =>
  render(await RegistrationsOverviewPage({ searchParams: Promise.resolve(query) }));

// ---------------------------------------------------------------------------
// SCRUM-74 — The registrations page for organisers and coordinators
// ---------------------------------------------------------------------------
describe("SCRUM-74 — Registrations overview page", () => {
  beforeEach(() => getEventRegistrations.mockClear());

  // AC2: organisers and coordinators reach this page from the sidebar (SCRUM-139/AC5), so it has its own heading, not a back link
  it("SCRUM-74/AC2, SCRUM-139/AC5 shows the page heading inside the shell instead of a back link", async () => {
    getManagedEvents.mockResolvedValue({ events: [TECH_SUMMIT] });

    await renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "Event registrations" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "← Back to dashboard" })).toBeNull();
  });
  // end of AC2

  // AC4: an organiser or coordinator with no events under them is told so
  it("SCRUM-74/AC4 says so when the caller has no events to manage", async () => {
    getManagedEvents.mockResolvedValue({ events: [] });

    await renderPage();

    expect(screen.getByText("You have no events to manage yet.")).toBeTruthy();
    expect(screen.queryByLabelText("Event")).toBeNull();
  });
  // end of AC4

  // AC3: the event chosen in the dropdown (now in the address) shows its summary and registrations
  it("SCRUM-74/AC3 shows the registrations and summary of the chosen event", async () => {
    getManagedEvents.mockResolvedValue({ events: [TECH_SUMMIT] });
    getEventRegistrations.mockResolvedValue({
      registrations: [
        {
          id: "reg-1",
          status: "confirmed",
          registered_at: "2026-10-01T02:00:00Z",
          name: "Alicia Fernandez",
          email: "alicia.fernandez@example.com",
          phone: "+65 9123 4567",
        },
      ],
    });

    await renderPage({ event: "evt-1" });

    expect(getEventRegistrations).toHaveBeenCalledWith("evt-1");
    expect(screen.getByText("Alicia Fernandez")).toBeTruthy();
    // SCRUM-139/AC4: the count against capacity, on the Slots remaining card
    const summary = screen.getByRole("list", { name: "Registration summary" });
    const slots = within(summary).getByText("Slots remaining").closest("li")!;
    expect(within(slots).getByText("9 of 10")).toBeTruthy();
  });

  // AC3: the chosen event's registrations couldn't load: say so, rather than an empty page
  it("SCRUM-74/AC3 shows the error when the chosen event's registrations can't load", async () => {
    getManagedEvents.mockResolvedValue({ events: [TECH_SUMMIT] });
    getEventRegistrations.mockResolvedValue({ error: "We couldn't load this event's registrations. Please try again." });

    await renderPage({ event: "evt-1" });

    expect(screen.getByRole("alert").textContent).toBe("We couldn't load this event's registrations. Please try again.");
  });
  // end of AC3

  // AC1: only the events under them: an event id typed into the address that isn't one of theirs is ignored
  it("SCRUM-74/AC1 doesn't load registrations for an event that isn't one of the caller's", async () => {
    getManagedEvents.mockResolvedValue({ events: [TECH_SUMMIT] });

    await renderPage({ event: "evt-someone-elses" });

    expect(getEventRegistrations).not.toHaveBeenCalled();
    expect(screen.getByText("Choose an event to see its registrations.")).toBeTruthy();
  });

  // AC1: anyone who isn't an organiser or coordinator is shown event-service's refusal, not "no events"
  it("SCRUM-74/AC1 shows the refusal for a caller who can't view registrations", async () => {
    getManagedEvents.mockResolvedValue({ error: "Only event organisers and coordinators can view registrations." });

    await renderPage();

    expect(screen.getByRole("alert").textContent).toBe("Only event organisers and coordinators can view registrations.");
    expect(screen.queryByText("You have no events to manage yet.")).toBeNull();
  });
  // end of AC1
});
// end of SCRUM-74

// ---------------------------------------------------------------------------
// SCRUM-169 — The organiser decides on Pending registrations from this page
// ---------------------------------------------------------------------------
describe("SCRUM-169 — Registrations overview page", () => {
  const PENDING = { id: "reg-1", status: "pending", registered_at: "2026-10-01T02:00:00Z", name: "Alicia", email: "a@example.com", phone: "91234567" };

  it.each([
    ["offers the organiser Confirm and Decline", true, 1],
    ["keeps the coordinator's view read-only", false, 0],
  ])("SCRUM-169/AC3 %s", async (_name, can_decide, buttons) => {
    getManagedEvents.mockResolvedValue({ events: [{ ...TECH_SUMMIT, can_decide }] });
    getEventRegistrations.mockResolvedValue({ registrations: [PENDING] });

    await renderPage({ event: "evt-1" });

    expect(screen.queryAllByRole("button", { name: "Confirm" })).toHaveLength(buttons);
    expect(screen.queryAllByRole("button", { name: "Decline" })).toHaveLength(buttons);
  });
});
// end of SCRUM-169
