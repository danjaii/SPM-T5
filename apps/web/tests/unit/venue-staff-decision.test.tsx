import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }), redirect: vi.fn() }));

import { VenueStaffDecision } from "@/components/VenueStaffDecision";
import { decisionActions } from "@/lib/venueBookings";

function mockServer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

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
    expect(screen.getByRole("dialog").textContent).toContain("Approve this request?");

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Yes, approve" }));
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
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Yes, approve" }));

    expect((await screen.findByRole("alert")).textContent).toBe("This request is no longer pending.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("38-S8: shows that the requested time has passed", async () => {
    mockServer(409, { code: "SLOT_IN_PAST", error: "The requested time has already passed." });
    render(<VenueStaffDecision booking={{ id: "b-1", status: "PENDING" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve request" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Yes, approve" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The requested time has already passed.");
  });

  it("falls back to a generic message when the server gives none", async () => {
    mockServer(500, {});
    render(<VenueStaffDecision booking={{ id: "b-1", status: "PENDING" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve request" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Yes, approve" }));
    expect((await screen.findByRole("alert")).textContent).toBe("We couldn't complete that. Please try again.");
  });
});

// SCRUM-38/AC4 (38-S4, the event shows its approved venue) is now covered by the list of every venue booking of the event:
// tests/unit/event-venue-bookings.test.tsx (SCRUM-98/AC5).

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
    return within(screen.getByRole("dialog"));
  };
  const type = (text: string) => fireEvent.change(screen.getByLabelText("Reason for rejection"), { target: { value: text } });

  it("39-S1: takes a reason, then rejects with the trimmed reason and refreshes", async () => {
    const fetchMock = mockServer(200, { id: "b-1", status: "REJECTED" });
    const dialog = open();
    expect(screen.getByRole("dialog").textContent).toContain("Reject this request?");
    type("  Room under renovation  ");
    expect(screen.getByText("21/500")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(dialog.getByRole("button", { name: "Reject request" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:4003/venue-bookings/b-1/reject");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ reason: "Room under renovation" });
  });

  it("cancelling closes the dialog without calling the server", () => {
    const fetchMock = mockServer(200, {});
    const dialog = open();
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Reason for rejection")).toBeNull();
    expect(screen.getByRole("button", { name: "Reject request" })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SCRUM-134/AC2 a reason is required before the rejection can be confirmed (39-S2)", () => {
  const attempt = (text: string) => {
    render(<VenueStaffDecision booking={{ id: "b-1", status: "PENDING" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Reject request" }));
    fireEvent.change(screen.getByLabelText("Reason for rejection"), { target: { value: text } });
    return within(screen.getByRole("dialog")).getByRole("button", { name: "Reject request" }) as HTMLButtonElement;
  };

  it.each([
    ["empty", ""],
    ["only spaces", "    "],
  ])("SCRUM-134/AC2: %s leaves the confirm button disabled and never calls the server", (_name, text) => {
    const fetchMock = mockServer(200, {});
    const confirm = attempt(text);
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("SCRUM-134/AC2: a reason enables the confirm button", () => {
    mockServer(200, {});
    expect(attempt("No room").disabled).toBe(false);
  });

  it("39-S2: 501 characters shows a validation message and never calls the server", () => {
    const fetchMock = mockServer(200, {});
    fireEvent.click(attempt("x".repeat(501)));
    expect(screen.getByRole("alert").textContent).toBe("The reason must be 500 characters or fewer.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("39-S2: 500 characters is accepted and the counter shows the limit", () => {
    mockServer(200, {});
    expect(attempt("x".repeat(500)).disabled).toBe(false);
    expect(screen.getByText("500/500")).toBeTruthy();
  });

  it("39-S2: the server field error is shown if it still refuses the reason", async () => {
    mockServer(422, {
      code: "VALIDATION_FAILED",
      error: "Some fields are invalid.",
      fieldErrors: { reason: "Enter a reason for the rejection." },
    });
    fireEvent.click(attempt("Fine"));
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
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Reject request" }));

    expect((await screen.findByRole("alert")).textContent).toBe("This request is no longer pending.");
    expect(refresh).not.toHaveBeenCalled();
  });
});
