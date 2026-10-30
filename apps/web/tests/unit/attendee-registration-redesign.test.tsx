// this test file checks the attendee registration redesign (SCRUM-139): the attendee's navigation, the confirmed state after
// registering, withdrawing only after a confirmation, and the registrations count against capacity

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { EventRegistrationForm } from "@/components/EventRegistrationForm";
import { MyRegistrationList } from "@/components/MyRegistrationList";
import { RegistrationSummary } from "@/components/RegistrationSummary";
import { NAV_ITEMS } from "@/lib/nav";
import type { EventRegistration, MyRegistration, RegistrationFormData } from "@/lib/eventRegistration";

const registration = (overrides: Partial<MyRegistration> = {}): MyRegistration => ({
  id: "reg-1",
  status: "confirmed",
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
});

const formData = (): RegistrationFormData => ({
  event: {
    id: "evt-1",
    name: "Tech Summit",
    start_at: "2026-12-12T11:00:00Z",
    end_at: "2026-12-12T13:00:00Z",
    venue: { name: "Orchid Hall", address: "Level 3, East Wing" },
    availability: "open",
    my_registration: null,
    status: "confirmed",
    organisation: null,
    category: null,
    coordinator: null,
    available_slots: 5,
    can_register: true,
  },
  prefill: { name: "Alicia Fernandez", email: "alicia.fernandez@example.com", phone: "+65 9123 4567" },
});

/** event-service answers the next request with `status` and `body`. */
function mockEventService(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockClear();
});

describe("SCRUM-139/AC1 attendee navigation", () => {
  // Given I am an Attendee, when I sign in, then the navigation has only Browse events and My registrations
  it("SCRUM-139/AC1 offers only Browse events and My registrations", () => {
    expect(NAV_ITEMS.attendee.map((i) => [i.label, i.href])).toEqual([
      ["Browse events", "/dashboard/attendee"],
      ["My registrations", "/registrations"],
    ]);
  });
});

describe("SCRUM-139/AC2 a confirmed registration", () => {
  // Given I register for an event, when it succeeds, then I see a confirmed state and a way to My registrations
  it("SCRUM-139/AC2 shows the confirmed state with a Confirmed badge and a link to My registrations", async () => {
    mockEventService(201, { event_name: "Tech Summit", status: "confirmed" });
    render(<EventRegistrationForm data={formData()} />);

    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    expect((await screen.findByRole("status")).textContent).toBe("You're registered for Tech Summit. Status: Confirmed.");
    expect(screen.getByText("Confirmed", { selector: "[data-tone]" }).getAttribute("data-tone")).toBe("success");
    expect(screen.getByRole("link", { name: "View my registrations" }).getAttribute("href")).toBe("/registrations");
    // the form is replaced, so the same event can't be registered for twice by accident
    expect(screen.queryByRole("button", { name: "Register" })).toBeNull();
  });

  // Given I have registered, then the event is a row in My registrations
  it("SCRUM-139/AC2 lists the registered event in My registrations", () => {
    render(<MyRegistrationList registrations={[registration()]} />);

    const row = screen.getAllByRole("row")[1];
    expect(within(row).getByText("Tech Summit")).toBeTruthy();
    expect(within(row).getByText("Confirmed", { selector: "[data-tone]" })).toBeTruthy();
  });
});

describe("SCRUM-139/AC3 withdrawing", () => {
  // Given I click Withdraw, when the confirmation appears, then nothing is sent until I confirm
  it("SCRUM-139/AC3 sends nothing until the withdrawal is confirmed, and nothing if it is cancelled", async () => {
    const fetchMock = mockEventService(200, { status: "withdrawn" });
    render(<MyRegistrationList registrations={[registration()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Withdraw from Tech Summit?")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Yes, withdraw" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:4002/events/my-registrations/reg-1/withdraw");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe("SCRUM-139/AC4 registrations against capacity", () => {
  const aRegistration = (id: string, status: EventRegistration["status"]): EventRegistration => ({
    id,
    status,
    registered_at: "2026-10-01T02:00:00Z",
    name: "Alicia Fernandez",
    email: "alicia.fernandez@example.com",
    phone: "+65 9123 4567",
  });

  // Given I am the organiser or coordinator, when I open the registrations, then I see the count against capacity
  it("SCRUM-139/AC4 shows the confirmed count against the capacity", () => {
    render(
      <RegistrationSummary
        registrations={[aRegistration("a", "confirmed"), aRegistration("b", "confirmed"), aRegistration("c", "pending")]}
        capacity={450}
      />,
    );

    const list = screen.getByRole("list", { name: "Registration summary" });
    expect(within(list).getByText("of 450 places")).toBeTruthy();
    expect(within(list).getByText("448 of 450")).toBeTruthy();
  });

  it("SCRUM-139/AC4 says there is no limit for an event without a capacity", () => {
    render(<RegistrationSummary registrations={[aRegistration("a", "confirmed")]} capacity={null} />);

    expect(screen.getByText("No limit on places")).toBeTruthy();
  });
});
