// this test file checks the attendee's registration form for one event

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventRegistrationForm } from "@/components/EventRegistrationForm";
import type { RegistrationFormData } from "@/lib/eventRegistration";

/** What event-service's GET /events/:id/registration-form sends; tests override only what they care about. */
function formData(overrides: { event?: Partial<RegistrationFormData["event"]>; prefill?: Partial<RegistrationFormData["prefill"]> } = {}): RegistrationFormData {
  return {
    event: {
      id: "evt-1",
      name: "Tech Summit",
      start_at: "2026-12-12T11:00:00Z",
      end_at: "2026-12-12T13:00:00Z",
      venue: { name: "Orchid Hall", address: "Level 3, East Wing" },
      availability: "open",
      my_registration: null,
      status: "confirmed",
      organisation: "TechConnect Pte Ltd",
      category: "Conference",
      coordinator: "Rachel Tan",
      available_slots: 40,
      ...overrides.event,
    },
    prefill: { name: "Alicia Fernandez", email: "alicia.fernandez@example.com", phone: "+65 9123 4567", ...overrides.prefill },
  };
}

/** event-service answers the registration POST with `status` and `body`. */
function mockEventService(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// SCRUM-83 — Register for an event: the registration form
// ---------------------------------------------------------------------------
describe("SCRUM-83 — Registration form", () => {
  // AC7: the form shows the event's name, date and time (Singapore time, as on the cards) and location
  it("SCRUM-83/AC7 shows the event's name, date and time, and location", () => {
    render(<EventRegistrationForm data={formData()} />);

    expect(screen.getByRole("heading", { name: "Tech Summit" })).toBeTruthy();
    expect(screen.getByText("Sat, 12 Dec 2026, 7:00 PM – 9:00 PM")).toBeTruthy();
    expect(screen.getByText("Orchid Hall, Level 3, East Wing")).toBeTruthy();
  });
  // end of AC7

  // AC8: name, contact number and email start with the attendee's own details, and can be changed
  it("SCRUM-83/AC8 prefills name, email and contact number, and lets the attendee edit them", () => {
    render(<EventRegistrationForm data={formData()} />);

    const name = screen.getByLabelText("Name") as HTMLInputElement;
    expect(name.value).toBe("Alicia Fernandez");
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("alicia.fernandez@example.com");
    expect((screen.getByLabelText("Contact number") as HTMLInputElement).value).toBe("+65 9123 4567");

    fireEvent.change(name, { target: { value: "Alicia F." } });
    expect(name.value).toBe("Alicia F.");
  });
  // end of AC8

  // AC9: no contact number in the profile means an empty field the attendee must fill in before registering
  it("SCRUM-83/AC9 starts with an empty contact number and asks for one on submit, sending nothing", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<EventRegistrationForm data={formData({ prefill: { phone: "" } })} />);

    const phone = screen.getByLabelText("Contact number") as HTMLInputElement;
    expect(phone.value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    // "next to the field": the message is the field's own error, which its input points at
    expect(document.getElementById(phone.getAttribute("aria-describedby")!)?.textContent).toBe("Contact number is required.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  // end of AC9

  // AC10: a missing required field shows an error next to that field, and nothing is sent (so nothing is created)
  it("SCRUM-83/AC10 shows an error next to an emptied name field and sends nothing", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<EventRegistrationForm data={formData()} />);

    const name = screen.getByLabelText("Name");
    fireEvent.change(name, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    expect(document.getElementById(name.getAttribute("aria-describedby")!)?.textContent).toBe("Name is required.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  // end of AC10

  // AC11: the email must be in a valid format (the shared rule event-service applies too)
  it("SCRUM-83/AC11 shows a format error next to an invalid email and sends nothing", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<EventRegistrationForm data={formData()} />);

    const email = screen.getByLabelText("Email");
    fireEvent.change(email, { target: { value: "alicia.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    expect(document.getElementById(email.getAttribute("aria-describedby")!)?.textContent).toBe("Enter a valid email address.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  // end of AC11

  // AC14: after a successful submission the attendee sees a success message with the event name and the status.
  // (The in-app notification is deferred to the notification-service story.)
  it("SCRUM-83/AC14 submits the details and confirms with the event name and the Pending status", async () => {
    const fetchMock = mockEventService(201, { event_name: "Tech Summit", status: "pending" });
    render(<EventRegistrationForm data={formData()} />);

    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    expect((await screen.findByRole("status")).textContent).toBe("You're registered for Tech Summit. Status: Pending.");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4002/events/evt-1/registrations");
    expect(JSON.parse(init.body)).toEqual({ name: "Alicia Fernandez", email: "alicia.fernandez@example.com", phone: "+65 9123 4567" });
  });
  // end of AC14

  // AC16: a repeated submit creates only one registration. The page sends one request however often Register is
  // pressed while it's sending (the database refuses a duplicate too: see event-service's integration tests).
  it("SCRUM-83/AC16 sends one request when Register is pressed twice", async () => {
    let answer!: (value: unknown) => void;
    const fetchMock = vi.fn().mockReturnValue(new Promise((resolve) => (answer = resolve))); // still sending…
    vi.stubGlobal("fetch", fetchMock);
    render(<EventRegistrationForm data={formData()} />);

    const register = screen.getByRole("button", { name: "Register" });
    fireEvent.click(register);
    fireEvent.click(register);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    answer({ ok: true, status: 201, json: async () => ({ event_name: "Tech Summit", status: "pending" }) });
    await screen.findByRole("status");
  });
  // end of AC16

  // AC17: the event became full, closed or cancelled while the form was open; event-service refuses (409) with a
  // clear message, which the attendee sees, and no success message is shown
  it("SCRUM-83/AC17 shows event-service's message when the registration is refused", async () => {
    mockEventService(409, { error: "This event has been cancelled." });
    render(<EventRegistrationForm data={formData()} />);

    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    expect((await screen.findByRole("alert")).textContent).toBe("This event has been cancelled.");
    expect(screen.queryByRole("status")).toBeNull();
  });
  // end of AC17

  // AC5: with an active (Pending or Confirmed) registration, Register isn't shown; that registration's status is
  // (e.g. a guest returned here after signing in, who had already registered)
  it("SCRUM-83/AC5 shows the attendee's active registration instead of the form", () => {
    render(<EventRegistrationForm data={formData({ event: { my_registration: "pending" } })} />);

    expect(screen.getByText("Your registration:").textContent).toBe("Your registration:Pending");
    expect(screen.queryByRole("button", { name: "Register" })).toBeNull();
  });
  // end of AC5

  // AC3, AC4 (and a cancelled event): the form page can be opened directly (a bookmark, or the sign-in redirect),
  // so like the card it hides Register and says why when registration isn't open
  it.each([
    ["closed", "Registration closed"],
    ["full", "Event full"],
    ["cancelled", "This event has been cancelled"],
  ] as const)("SCRUM-83/AC3, AC4 shows why instead of the form when the event is %s", (availability, message) => {
    render(<EventRegistrationForm data={formData({ event: { availability } })} />);

    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Register" })).toBeNull();
  });
});
// end of SCRUM-83
