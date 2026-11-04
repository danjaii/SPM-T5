// SCRUM-116 — only the Safety Officer can make the safety check decision

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ROLES } from "@spm-t5/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShellContext } from "@/components/shell/ShellContext";
import { SafetyCheckActions } from "@/components/SafetyCheckActions";

/** The radio for an outcome; its name also holds the line that says what it does, so match the start. */
const outcome = (label: string) => screen.getByRole("radio", { name: new RegExp(`^${label}`) });
const submitButton = () => screen.getByRole("button", { name: "Submit decision" });

describe("SCRUM-116/AC1 — Safety Officers can make safety decisions", () => {
  it("SCRUM-116/AC1 offers a Safety Officer Approve, Reject and Request changes", () => {
    render(<SafetyCheckActions role="safety_officer" eventId="evt-1" />);

    expect(outcome("Approve")).toBeTruthy();
    expect(outcome("Reject")).toBeTruthy();
    expect(outcome("Request changes")).toBeTruthy();
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
describe("SCRUM-99/AC4 the chosen outcome stands out", () => {
  /** Which outcomes are selected: one radio is checked at most. */
  const checked = () =>
    ["Approve", "Reject", "Request changes"].filter((label) => outcome(label).getAttribute("aria-checked") === "true");

  it("SCRUM-99/AC4 selects only the outcome the Safety Officer has chosen", () => {
    render(<SafetyCheckActions role="safety_officer" eventId="evt-1" />);
    expect(checked()).toEqual([]);

    fireEvent.click(outcome("Reject"));

    expect(checked()).toEqual(["Reject"]);
  });
});

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

    fireEvent.click(outcome("Reject"));
    fireEvent.click(submitButton());

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

    fireEvent.click(outcome("Approve"));
    fireEvent.change(screen.getByLabelText("Comments (optional)"), { target: { value: "Exits clear" } });
    fireEvent.click(submitButton());

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

    fireEvent.click(outcome("Request changes"));
    fireEvent.change(screen.getByLabelText("Reason or comments"), { target: { value: "Move the PA away from the east exit" } });
    fireEvent.click(submitButton());

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Changes Requested");
    expect(status.textContent).toContain("by Farah Ismail on 2031-06-01 10:00");
    expect(screen.getByText("Move the PA away from the east exit")).toBeTruthy();
  });
});

describe("SCRUM-99/AC4 when event-service refuses the decision", () => {
  it("SCRUM-99/AC4 shows the refusal and keeps the choices, e.g. when another Safety Officer decided first", async () => {
    mockServer(409, { error: "This event isn't waiting for a safety check." });
    render(<SafetyCheckActions role="safety_officer" eventId="evt-1" />);

    fireEvent.click(outcome("Approve"));
    fireEvent.click(submitButton());

    expect((await screen.findByRole("alert")).textContent).toBe("This event isn't waiting for a safety check.");
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("SCRUM-142/AC3 confirm a decision", () => {
  it("SCRUM-142/AC3 shows the submit button in the destructive style only for Reject", () => {
    render(<SafetyCheckActions role="safety_officer" eventId="evt-1" />);
    const isDestructive = () => submitButton().className.includes("bg-destructive");

    fireEvent.click(outcome("Approve"));
    expect(isDestructive()).toBe(false);
    fireEvent.click(outcome("Request changes"));
    expect(isDestructive()).toBe(false);
    fireEvent.click(outcome("Reject"));
    expect(isDestructive()).toBe(true);
  });

  it("SCRUM-142/AC3 stops Request changes without a note before anything is sent", () => {
    const fetchMock = mockServer(201, {});
    render(<SafetyCheckActions role="safety_officer" eventId="evt-1" />);

    fireEvent.click(outcome("Request changes"));
    fireEvent.click(submitButton());

    expect(screen.getByRole("alert").textContent).toBe("Say what needs to change.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("SCRUM-142/AC3 sends the notes on flagged factors as the reason for Request changes", async () => {
    const fetchMock = mockServer(201, {
      decision: "changes_requested",
      reason: "Equipment placement: Keep aisle 3 clear",
      officer_name: "Farah Ismail",
      decided_at: "2031-06-01T02:00:00Z",
      label: "Changes Requested",
    });
    render(<SafetyCheckActions role="safety_officer" eventId="evt-1" concerns={[{ title: "Equipment placement", note: "Keep aisle 3 clear" }]} />);

    fireEvent.click(outcome("Request changes"));
    expect(screen.getByText("Planning · venue and equipment")).toBeTruthy();
    fireEvent.click(submitButton());

    await screen.findByRole("status");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      decision: "changes_requested",
      reason: "Equipment placement: Keep aisle 3 clear",
    });
  });
});

// ---------------------------------------------------------------------------
// SCRUM-178 — the sidebar's Safety checks count follows a recorded decision
// ---------------------------------------------------------------------------
describe("SCRUM-178/AC1 recording a decision updates the sidebar count", () => {
  function renderInShell() {
    const refreshCounts = vi.fn();
    render(
      <ShellContext.Provider value={{ user: { fullName: "Farah Ismail", role: "safety_officer" }, counts: { safetyQueue: 2 }, refreshCounts }}>
        <SafetyCheckActions role="safety_officer" eventId="evt-1" />
      </ShellContext.Provider>,
    );
    return refreshCounts;
  }

  it("SCRUM-178/AC1 reads the count again once the decision is saved, and keeps the message on screen", async () => {
    mockServer(201, { decision: "approved", reason: null, officer_name: "Farah Ismail", decided_at: "2031-06-01T02:00:00Z", label: "Safety Approved" });
    const refreshCounts = renderInShell();

    fireEvent.click(outcome("Approve"));
    fireEvent.click(submitButton());

    await waitFor(() => expect(refreshCounts).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status").textContent).toContain("Decision recorded: Safety Approved");
  });

  it("SCRUM-178/AC1 leaves the count alone when the decision is refused", async () => {
    mockServer(409, { error: "This event isn't waiting for a safety check." });
    const refreshCounts = renderInShell();

    fireEvent.click(outcome("Approve"));
    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("isn't waiting"));
    expect(refreshCounts).not.toHaveBeenCalled();
  });
});
