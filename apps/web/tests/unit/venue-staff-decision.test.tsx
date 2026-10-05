import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }), redirect: vi.fn() }));

const { cookieValue } = vi.hoisted(() => ({ cookieValue: { current: "token-123" as string | undefined } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));

import { EventVenueBooking } from "@/components/EventVenueBooking";
import { VenueStaffDecision } from "@/components/VenueStaffDecision";
import { decisionActions } from "@/lib/venueBookings";
import { getApprovedVenueBooking } from "@/lib/venueBookingsServer";

function mockServer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  cookieValue.current = "token-123";
});
afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
  refresh.mockClear();
});

describe("SCRUM-38/AC2 the approve action is offered only for a pending request (38-S2)", () => {
  it("38-S2: PENDING can be approved", () => {
    expect(decisionActions("PENDING").approve).toBe(true);
  });

  it.each(["APPROVED", "REJECTED", "WITHDRAWN", undefined] as const)("38-S2: no action for %s", (status) => {
    expect(decisionActions(status)).toEqual({ approve: false, reject: false });
  });

  it.each(["APPROVED", "REJECTED", "WITHDRAWN"] as const)("38-S2: %s renders nothing", (status) => {
    const { container } = render(<VenueStaffDecision booking={{ id: "b-1", status }} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("SCRUM-38/AC1 approving (38-S1)", () => {
  it("38-S1: asks to confirm, then approves and refreshes", async () => {
    const fetchMock = mockServer(200, { id: "b-1", status: "APPROVED" });
    render(<VenueStaffDecision booking={{ id: "b-1", status: "PENDING" }} />);

    fireEvent.click(screen.getByRole("button", { name: "Approve request" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog").textContent).toContain("Approve this request?");

    fireEvent.click(screen.getByRole("button", { name: "Yes, approve" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:4003/venue-bookings/b-1/approve");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(fetchMock.mock.calls[0][1].credentials).toBe("include");
  });

  it("cancelling the confirmation does not call the server", () => {
    const fetchMock = mockServer(200, {});
    render(<VenueStaffDecision booking={{ id: "b-1", status: "PENDING" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve request" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SCRUM-38/AC3 and AC8 the server's refusal is shown (38-S3, 38-S8)", () => {
  it("38-S3: shows the NOT_PENDING message when another decision won", async () => {
    mockServer(409, { code: "NOT_PENDING", error: "This request is no longer pending." });
    render(<VenueStaffDecision booking={{ id: "b-1", status: "PENDING" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve request" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, approve" }));

    expect((await screen.findByRole("alert")).textContent).toBe("This request is no longer pending.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("38-S8: shows that the requested time has passed", async () => {
    mockServer(409, { code: "SLOT_IN_PAST", error: "The requested time has already passed." });
    render(<VenueStaffDecision booking={{ id: "b-1", status: "PENDING" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve request" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, approve" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The requested time has already passed.");
  });

  it("falls back to a generic message when the server gives none", async () => {
    mockServer(500, {});
    render(<VenueStaffDecision booking={{ id: "b-1", status: "PENDING" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve request" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, approve" }));
    expect((await screen.findByRole("alert")).textContent).toBe("We couldn't complete that. Please try again.");
  });
});

describe("SCRUM-38/AC4 the event shows its approved venue (38-S4)", () => {
  const booking = { venueName: "Orchid Hall", date: "2026-11-14", startTime: "09:00", endTime: "17:00" };

  it("38-S4: shows the venue, date and time", () => {
    render(<EventVenueBooking booking={booking} />);
    expect(screen.getByText("Orchid Hall")).toBeTruthy();
    expect(screen.getByText(/2026-11-14/).textContent).toContain("09:00");
    expect(screen.getByText(/2026-11-14/).textContent).toContain("17:00");
  });

  it("38-S4: renders nothing when there is no approved venue", () => {
    const { container } = render(<EventVenueBooking booking={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("38-S4: fetches the booking for the event as the signed-in user", async () => {
    const fetchMock = mockServer(200, booking);
    expect(await getApprovedVenueBooking("evt 1")).toEqual(booking);
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:4003/events/evt%201/venue-booking");
    expect(fetchMock.mock.calls[0][1].headers.cookie).toContain("token-123");
  });

  it("38-S4: degrades to null on a refusal, an error, a network failure or no session", async () => {
    mockServer(403, { error: "no" });
    expect(await getApprovedVenueBooking("evt-1")).toBeNull();
    mockServer(200, null);
    expect(await getApprovedVenueBooking("evt-1")).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await getApprovedVenueBooking("evt-1")).toBeNull();
    cookieValue.current = undefined;
    const fetchMock = mockServer(200, booking);
    expect(await getApprovedVenueBooking("evt-1")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SCRUM-39/AC3 the reject action is offered only for a pending request (39-S3)", () => {
  it("39-S3: PENDING can be rejected", () => {
    expect(decisionActions("PENDING").reject).toBe(true);
  });

  it.each(["APPROVED", "REJECTED", "WITHDRAWN"] as const)("39-S3: no reject button for %s", (status) => {
    render(<VenueStaffDecision booking={{ id: "b-1", status }} />);
    expect(screen.queryByRole("button", { name: "Reject request" })).toBeNull();
  });
});

describe("SCRUM-39/AC1 rejecting with a reason (39-S1)", () => {
  const open = () => {
    render(<VenueStaffDecision booking={{ id: "b-1", status: "PENDING" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Reject request" }));
  };
  const type = (text: string) => fireEvent.change(screen.getByLabelText("Reason for rejection"), { target: { value: text } });

  it("39-S1: takes a reason, asks to confirm, then rejects with the trimmed reason and refreshes", async () => {
    const fetchMock = mockServer(200, { id: "b-1", status: "REJECTED" });
    open();
    type("  Room under renovation  ");
    expect(screen.getByText("21/500")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog").textContent).toContain("Reject this request?");
    expect(screen.getByRole("alertdialog").textContent).toContain("Room under renovation");

    fireEvent.click(screen.getByRole("button", { name: "Yes, reject" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:4003/venue-bookings/b-1/reject");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ reason: "Room under renovation" });
  });

  it("editing the reason from the confirmation goes back to the form with the text kept", () => {
    mockServer(200, {});
    open();
    type("Because");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit reason" }));
    expect((screen.getByLabelText("Reason for rejection") as HTMLTextAreaElement).value).toBe("Because");
  });

  it("cancelling closes the form without calling the server", () => {
    const fetchMock = mockServer(200, {});
    open();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Reason for rejection")).toBeNull();
    expect(screen.getByRole("button", { name: "Reject request" })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SCRUM-39/AC2 a reason is required (39-S2)", () => {
  const attempt = (text: string) => {
    render(<VenueStaffDecision booking={{ id: "b-1", status: "PENDING" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Reject request" }));
    fireEvent.change(screen.getByLabelText("Reason for rejection"), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  };

  it.each([
    ["empty", "", "Enter a reason for the rejection."],
    ["only spaces", "    ", "Enter a reason for the rejection."],
    ["501 characters", "x".repeat(501), "The reason must be 500 characters or fewer."],
  ])("39-S2: %s shows a validation message and never calls the server", (_name, text, message) => {
    const fetchMock = mockServer(200, {});
    attempt(text);
    expect(screen.getByRole("alert").textContent).toBe(message);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("39-S2: 500 characters is accepted and the counter shows the limit", () => {
    mockServer(200, {});
    attempt("x".repeat(500));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit reason" }));
    expect(screen.getByText("500/500")).toBeTruthy();
  });

  it("39-S2: the server field error is shown if it still refuses the reason", async () => {
    mockServer(422, {
      code: "VALIDATION_FAILED",
      error: "Some fields are invalid.",
      fieldErrors: { reason: "Enter a reason for the rejection." },
    });
    attempt("Fine");
    fireEvent.click(screen.getByRole("button", { name: "Yes, reject" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Enter a reason for the rejection.");
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("SCRUM-39/AC5 the server refusal is shown (39-S5)", () => {
  it("39-S5: shows the NOT_PENDING message when another decision won", async () => {
    mockServer(409, { code: "NOT_PENDING", error: "This request is no longer pending." });
    render(<VenueStaffDecision booking={{ id: "b-1", status: "PENDING" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Reject request" }));
    fireEvent.change(screen.getByLabelText("Reason for rejection"), { target: { value: "No room" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, reject" }));

    expect((await screen.findByRole("alert")).textContent).toBe("This request is no longer pending.");
    expect(refresh).not.toHaveBeenCalled();
  });
});
