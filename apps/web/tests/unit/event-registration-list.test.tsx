// this test file checks the registration information page that organisers and coordinators see for one event

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventRegistrationList } from "@/components/EventRegistrationList";
import type { EventRegistration } from "@/lib/eventRegistration";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

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
            is_vip: false,
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
  is_vip: false,
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

    expect(screen.getByTestId("registration-scroll").className).toContain("overflow-y-auto");
  });

  // AC10: 15 rows or fewer show in full, with no scrolling
  it("SCRUM-74/AC10 shows a list of 15 registrations in full, without scrolling", () => {
    render(<EventRegistrationList registrations={registrations(15)} />);

    expect(screen.getByTestId("registration-scroll").className).not.toContain("overflow-y-auto");
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

// ---------------------------------------------------------------------------
// SCRUM-169 — The organiser confirms or declines a Pending registration
// ---------------------------------------------------------------------------
describe("SCRUM-169 — Confirm or decline in the registration list", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    refresh.mockClear();
  });

  function mockEventService(status: number, body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  // AC3: a decision is only waiting on a Pending registration
  it("SCRUM-169/AC3 offers Confirm and Decline on Pending rows only", () => {
    render(
      <EventRegistrationList
        eventId="evt-1"
        canDecide
        registrations={[aRegistration({ id: "reg-p" }), aRegistration({ id: "reg-c", status: "confirmed" })]}
      />,
    );

    const [pending, confirmed] = screen.getAllByRole("row").slice(1);
    expect(within(pending).getByRole("button", { name: "Confirm" })).toBeTruthy();
    expect(within(pending).getByRole("button", { name: "Decline" })).toBeTruthy();
    expect(within(confirmed).queryByRole("button")).toBeNull();
  });

  // AC3: the coordinator's view, and the event's own registrations page, stay read-only
  it("SCRUM-169/AC3 shows no controls without canDecide", () => {
    render(<EventRegistrationList registrations={[aRegistration()]} />);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each([
    ["Confirm", "confirm"],
    ["Decline", "decline"],
  ])("SCRUM-169/AC3 sends %s to event-service and reloads the list", async (button, decision) => {
    const fetchMock = mockEventService(200, { status: "confirmed" });
    render(<EventRegistrationList eventId="evt-1" canDecide registrations={[aRegistration()]} />);

    fireEvent.click(screen.getByRole("button", { name: button }));

    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/events\/evt-1\/registrations\/reg-1\/decision$/);
    expect(init).toMatchObject({ method: "POST", credentials: "include", body: JSON.stringify({ decision }) });
  });

  // AC4: the refusal is shown, and the registration stays Pending
  it("SCRUM-169/AC4 shows why confirming was refused on a full event", async () => {
    const message = "This event is full. A place must be freed before you can confirm this registration.";
    mockEventService(409, { error: message });
    render(<EventRegistrationList eventId="evt-1" canDecide registrations={[aRegistration()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText(message)).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("SCRUM-169/AC3 says so when event-service can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<EventRegistrationList eventId="evt-1" canDecide registrations={[aRegistration()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Decline" }));

    expect(await screen.findByText("We couldn't reach the server. Please try again.")).toBeTruthy();
  });
});
// end of SCRUM-169

// ---------------------------------------------------------------------------
// SCRUM-170 — The VIP label
// ---------------------------------------------------------------------------
describe("SCRUM-170 — VIP label in the registration list", () => {
  // Status is never colour alone: the label has an icon and words
  it("SCRUM-170/AC1 labels VIP rows, with an icon, and no others", () => {
    render(<EventRegistrationList registrations={[aRegistration({ id: "reg-vip", status: "confirmed", is_vip: true }), aRegistration({ id: "reg-normal" })]} />);

    const [vip, normal] = screen.getAllByRole("row").slice(1);
    expect(within(within(vip).getByText("VIP")).getByTestId("status-icon")).toBeTruthy();
    expect(within(normal).queryByText("VIP")).toBeNull();
  });
});
// end of SCRUM-170
