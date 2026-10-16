// SCRUM-116 — only the Safety Officer can make the safety check decision

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ROLES } from "@spm-t5/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SafetyCheckActions } from "@/components/SafetyCheckActions";

describe("SCRUM-116/AC1 — Safety Officers can make safety decisions", () => {
  it("SCRUM-116/AC1 offers a Safety Officer Approve, Reject and Request changes", () => {
    render(<SafetyCheckActions role="safety_officer" eventId="evt-1" />);

    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Request changes" })).toBeTruthy();
  });
});

describe("SCRUM-116/AC2 — Other roles cannot make safety decisions", () => {
  // Every other role comes from the shared ROLES list, so a role added later is asked about too.
  it.each(ROLES.filter((role) => role !== "safety_officer"))("SCRUM-116/AC2 offers a %s none of the safety decisions", (role) => {
    const { container } = render(<SafetyCheckActions role={role} eventId="evt-1" />);

    expect(container.innerHTML).toBe("");
  });
});

// ---------------------------------------------------------------------------
// SCRUM-99 — the Safety Officer records the safety check decision
// ---------------------------------------------------------------------------
function mockServer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-99/AC4 + AC6 choose an outcome; Reject needs a reason", () => {
  it("SCRUM-99/AC6 stops a Reject without a reason before anything is sent", () => {
    const fetchMock = mockServer(201, {});
    render(<SafetyCheckActions role="safety_officer" eventId="evt-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit decision" }));

    expect(screen.getByRole("alert").textContent).toBe("Give a reason for rejecting this event.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SCRUM-99/AC5 + AC8 approve an event", () => {
  it("SCRUM-99/AC5 sends the Approve to event-service and shows the event is Safety Approved", async () => {
    const fetchMock = mockServer(201, {
      decision: "approved",
      reason: "Exits clear",
      officer_name: "Farah Ismail",
      decided_at: "2031-06-01T02:00:00Z", // 10:00 AM in Singapore
      label: "Safety Approved",
    });
    render(<SafetyCheckActions role="safety_officer" eventId="evt-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.change(screen.getByLabelText("Comments (optional)"), { target: { value: "Exits clear" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit decision" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Safety Approved"));
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4002/safety-checks/evt-1/decision");
    expect(options).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse(options.body)).toEqual({ decision: "approved", reason: "Exits clear" });
  });

  it("SCRUM-99/AC8 shows the recorded Safety Officer, date and time, and comments", async () => {
    mockServer(201, {
      decision: "changes_requested",
      reason: "Move the PA away from the east exit",
      officer_name: "Farah Ismail",
      decided_at: "2031-06-01T02:00:00Z", // 10:00 AM in Singapore
      label: "Changes Requested",
    });
    render(<SafetyCheckActions role="safety_officer" eventId="evt-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Request changes" }));
    fireEvent.change(screen.getByLabelText("Reason or comments"), { target: { value: "Move the PA away from the east exit" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit decision" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Changes Requested");
    expect(status.textContent).toContain("by Farah Ismail on 2031-06-01 10:00");
    expect(status.textContent).toContain("Move the PA away from the east exit");
  });
});

describe("SCRUM-99/AC4 when event-service refuses the decision", () => {
  it("SCRUM-99/AC4 shows the refusal and keeps the choices, e.g. when another Safety Officer decided first", async () => {
    mockServer(409, { error: "This event isn't waiting for a safety check." });
    render(<SafetyCheckActions role="safety_officer" eventId="evt-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit decision" }));

    expect((await screen.findByRole("alert")).textContent).toBe("This event isn't waiting for a safety check.");
    expect(screen.queryByRole("status")).toBeNull();
  });
});
