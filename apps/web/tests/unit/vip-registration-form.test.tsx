// this test file checks the form where an event's organiser adds a VIP past the registration cap

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VipRegistrationForm } from "@/components/VipRegistrationForm";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

function mockEventService(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function submit(email: string) {
  fireEvent.change(screen.getByLabelText("Attendee's email"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Add VIP" }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockClear();
});

describe("SCRUM-170 — Add a VIP form", () => {
  it("SCRUM-170/AC1 adds the VIP, says so, clears the field and reloads the list", async () => {
    const fetchMock = mockEventService(201, { status: "confirmed" });
    render(<VipRegistrationForm eventId="evt-1" />);

    submit("vip@example.com");

    expect((await screen.findByRole("status")).textContent).toBe("vip@example.com is now Confirmed as a VIP.");
    expect(refresh).toHaveBeenCalled();
    expect((screen.getByLabelText("Attendee's email") as HTMLInputElement).value).toBe("");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/events\/evt-1\/vip-registrations$/);
    expect(init).toMatchObject({ method: "POST", credentials: "include", body: JSON.stringify({ email: "vip@example.com" }) });
  });

  it("SCRUM-170/AC1 shows an error next to the field and sends nothing for an invalid email", () => {
    const fetchMock = mockEventService(201, {});
    render(<VipRegistrationForm eventId="evt-1" />);

    submit("not-an-email");

    expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // AC2: the refusal is shown, and what was typed stays so it can be corrected
  it("SCRUM-170/AC2 shows event-service's refusal and keeps the email", async () => {
    const message = "This would take the event past its venue's capacity of 120.";
    mockEventService(409, { error: message });
    render(<VipRegistrationForm eventId="evt-1" />);

    submit("vip@example.com");

    expect(await screen.findByText(message)).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Attendee's email") as HTMLInputElement).value).toBe("vip@example.com");
  });

  it("SCRUM-170/AC1 says so when event-service can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<VipRegistrationForm eventId="evt-1" />);

    submit("vip@example.com");

    expect(await screen.findByText("We couldn't reach the server. Please try again.")).toBeTruthy();
  });
});
