// this test file checks the attendee's "My registrations" list

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { MyRegistrationList } from "@/components/MyRegistrationList";
import type { MyRegistration } from "@/lib/eventRegistration";

/** One registration as event-service's GET /events/my-registrations sends it. */
function aRegistration(overrides: Partial<MyRegistration> = {}): MyRegistration {
  return {
    id: "reg-1",
    status: "pending",
    registered_at: "2026-10-01T02:00:00Z",
    can_withdraw: true,
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

/** event-service answers the withdraw POST with `status` and `body`. */
function mockEventService(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockClear();
});

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
  it("SCRUM-72/AC3, SCRUM-139/AC7 shows each status as a badge with an icon, a label and its own tone", () => {
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

    // SCRUM-139/AC7: each status is a StatusBadge: its own tone, an icon and its label
    const tones = { Pending: "info", Confirmed: "success", Rejected: "danger", Withdrawn: "neutral" };
    for (const [label, tone] of Object.entries(tones)) {
      const badge = screen.getByText(label, { selector: "[data-tone]" });
      expect(badge.getAttribute("data-tone")).toBe(tone);
      expect(within(badge).getByTestId("status-icon")).toBeTruthy();
    }
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

// ---------------------------------------------------------------------------
// SCRUM-73 — Withdraw from an event, on "My registrations"
// ---------------------------------------------------------------------------
describe("SCRUM-73 — Withdraw from an event (My registrations)", () => {
  // AC3: the attendee must confirm in a pop-up before the withdrawal is processed, so nothing is sent yet
  it("SCRUM-73/AC3 asks the attendee to confirm in a pop-up before withdrawing", async () => {
    const fetchMock = mockEventService(200, { status: "withdrawn" });
    render(<MyRegistrationList registrations={[aRegistration()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));

    expect(await screen.findByRole("dialog", { name: "Withdraw from Tech Summit?" })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  // end of AC3

  // AC4: the attendee can cancel the pop-up without making any changes
  it("SCRUM-73/AC4 closes the pop-up on Cancel without withdrawing", async () => {
    const fetchMock = mockEventService(200, { status: "withdrawn" });
    render(<MyRegistrationList registrations={[aRegistration()]} />);
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    const dialog = await screen.findByRole("dialog", { name: "Withdraw from Tech Summit?" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Pending")).toBeTruthy();
  });
  // end of AC4

  // AC6: after confirming, the registration is withdrawn, the attendee sees a success message, and the list reloads
  // from the server, so its status reads Withdrawn
  it("SCRUM-73/AC6 withdraws on confirm and shows a success message", async () => {
    const fetchMock = mockEventService(200, { status: "withdrawn" });
    render(<MyRegistrationList registrations={[aRegistration({ id: "reg-1" })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    const dialog = await screen.findByRole("dialog", { name: "Withdraw from Tech Summit?" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Yes, withdraw" }));

    expect((await screen.findByRole("status")).textContent).toBe("You have withdrawn from Tech Summit.");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/events\/my-registrations\/reg-1\/withdraw$/),
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  // AC6: no success message when event-service refused (e.g. the event was cancelled after the page loaded):
  // its reason is shown instead
  it("SCRUM-73/AC6 shows event-service's reason when the withdrawal is refused", async () => {
    mockEventService(409, { error: "This event has been cancelled." });
    render(<MyRegistrationList registrations={[aRegistration()]} />);
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    const dialog = await screen.findByRole("dialog", { name: "Withdraw from Tech Summit?" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Yes, withdraw" }));

    expect((await screen.findByRole("alert")).textContent).toBe("This event has been cancelled.");
    expect(screen.queryByRole("status")).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });
  // end of AC6

  // AC2: only a Pending or Confirmed registration can be withdrawn, so a Withdrawn or Rejected one has no Withdraw button
  it("SCRUM-73/AC2 offers no Withdraw for a Withdrawn or Rejected registration", () => {
    render(
      <MyRegistrationList
        registrations={[
          aRegistration({ id: "reg-withdrawn", status: "withdrawn", can_withdraw: false }),
          aRegistration({ id: "reg-rejected", status: "rejected", can_withdraw: false }),
        ]}
      />,
    );

    expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
  });
  // end of AC2

  // AC5: Withdraw is disabled for an event that has started, ended or been cancelled: event-service says so with
  // can_withdraw (unit test SCRUM-73/AC2,AC5 in event-service)
  it("SCRUM-73/AC5 disables Withdraw when the registration can no longer be withdrawn", () => {
    render(<MyRegistrationList registrations={[aRegistration({ status: "confirmed", can_withdraw: false })]} />);

    expect((screen.getByRole("button", { name: "Withdraw" }) as HTMLButtonElement).disabled).toBe(true);
  });
  // end of AC5
});
// end of SCRUM-73
