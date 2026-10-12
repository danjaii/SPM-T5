import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookieValue, redirect } = vi.hoisted(() => ({
  cookieValue: { current: "token-lead" as string | undefined },
  redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));
vi.mock("next/navigation", () => ({ redirect, useRouter: () => ({ refresh: vi.fn() }) }));

import LeadReassignPage from "@/app/lead/events/[id]/reassign/page";
import { LeadAssignForm } from "@/components/LeadAssignForm";
import { LeadCoordinatorEvents } from "@/components/LeadCoordinatorEvents";
import type { LeadCoordinator, LeadCoordinatorEvent } from "@/lib/leadServer";

const marcus: LeadCoordinator = { id: "c-2", full_name: "Marcus Lim", workload: 1 };
const siti: LeadCoordinator = { id: "c-3", full_name: "Siti Aminah", workload: 0 };
const event: LeadCoordinatorEvent = {
  id: "evt-1",
  name: "Tech Summit",
  status: "planning",
  preferred_start_datetime: "2031-06-15T01:00:00Z",
  preferred_end_datetime: "2031-06-15T09:00:00Z",
  expected_attendance: 120,
};
const reassignment = (over: Record<string, unknown> = {}) => ({
  event: {
    id: "evt-1",
    name: "Tech Summit",
    status: "planning",
    organiser_name: "Jason Chua",
    preferred_start_datetime: "2031-06-15T01:00:00Z",
    preferred_end_datetime: "2031-06-15T09:00:00Z",
    expected_attendance: 120,
    submitted_at: "2031-01-02T03:04:00Z",
  },
  current: { id: "c-1", full_name: "Rachel Tan" },
  canReassign: true,
  coordinators: [marcus, siti],
  ...over,
});

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const renderForm = (coordinators = [marcus, siti]) =>
  render(
    <LeadAssignForm
      mode="reassign"
      eventId="evt-1"
      eventName="Tech Summit"
      current={{ id: "c-1", full_name: "Rachel Tan" }}
      coordinators={coordinators}
      cancelHref="/lead/coordinators/c-1"
    />,
  );
const open = async () => render(await LeadReassignPage({ params: Promise.resolve({ id: "evt-1" }) }));

beforeEach(() => {
  cookieValue.current = "token-lead";
  redirect.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------------------
// SCRUM-79 — Reassign an Event Coordinator
// ---------------------------------------------------------------------------
describe("SCRUM-79 — Reassign an Event Coordinator", () => {
  // AC1: from a coordinator's active events, the Lead can choose to reassign each one
  it("SCRUM-79/AC1 each of a coordinator's active events has a Reassign action", () => {
    render(<LeadCoordinatorEvents events={[event]} />);

    expect(screen.getByRole("link", { name: "Reassign Tech Summit" }).getAttribute("href")).toBe("/lead/events/evt-1/reassign");
  });
  // end of AC1

  // AC2: who is assigned now; the other eligible coordinators with their workload; the current one can't be chosen
  it("SCRUM-79/AC2 shows the current coordinator and offers only the others, each with their workload count", () => {
    renderForm();

    expect(screen.getByText("Currently assigned to Rachel Tan")).toBeTruthy();
    expect(screen.getAllByRole("radio").map((r) => r.closest("label")!.textContent)).toEqual([
      "Marcus Lim (1 active events)",
      "Siti Aminah (0 active events)",
    ]);
    expect(screen.queryByRole("radio", { name: /Rachel Tan/ })).toBeNull();
  });
  // end of AC2

  // AC3: confirming makes the new coordinator the only one
  it("SCRUM-79/AC3 reassigns to the chosen coordinator on confirm", async () => {
    const fetchMock = mockFetch(200, { assigned_coordinator_id: "c-3" });
    renderForm();

    fireEvent.click(screen.getByRole("radio", { name: "Siti Aminah (0 active events)" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm reassignment" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Tech Summit is now assigned to Siti Aminah."));
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4002/lead/events/evt-1/reassign",
      expect.objectContaining({ method: "POST", credentials: "include", body: JSON.stringify({ coordinator_id: "c-3" }) }),
    );
  });

  it("SCRUM-79/AC3 shows the refusal, and not a success, when event-service refuses", async () => {
    mockFetch(409, { error: "This coordinator is already assigned to the event." });
    renderForm();

    fireEvent.click(screen.getByRole("radio", { name: "Marcus Lim (1 active events)" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm reassignment" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("This coordinator is already assigned to the event."));
    expect(screen.queryByRole("status")).toBeNull();
  });
  // end of AC3

  // AC6: nobody but the current coordinator: told so, and nothing to confirm
  it("SCRUM-79/AC6 says no other coordinators are available, and offers no confirm, when there are none", () => {
    renderForm([]);

    expect(screen.getByText("No other eligible coordinators are available.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm reassignment" })).toBeNull();
    expect(screen.getByText("Currently assigned to Rachel Tan")).toBeTruthy();
  });
  // end of AC6

  // AC7: cancelling before confirming sends nothing; the assignment is unchanged
  it("SCRUM-79/AC7 cancelling before confirming sends nothing and returns to the coordinator's events", () => {
    const fetchMock = mockFetch(200, {});
    renderForm();

    fireEvent.click(screen.getByRole("radio", { name: "Marcus Lim (1 active events)" }));
    const cancel = screen.getByRole("link", { name: "Cancel" });

    expect(cancel.getAttribute("href")).toBe("/lead/coordinators/c-1");
    fireEvent.click(cancel);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  // end of AC7
});

describe("SCRUM-79 — The reassign page", () => {
  it("SCRUM-79/AC1 SCRUM-79/AC2 loads the event, its current coordinator and the choices as the signed-in Lead", async () => {
    const fetchMock = mockFetch(200, reassignment());

    await open();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4002/lead/events/evt-1/reassignment",
      expect.objectContaining({ headers: { cookie: "cs_session=token-lead" }, cache: "no-store" }),
    );
    expect(screen.getByRole("heading", { name: "Reassign Tech Summit" })).toBeTruthy();
    expect(screen.getByText("Currently assigned to Rachel Tan")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Marcus Lim (1 active events)" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Cancel" }).getAttribute("href")).toBe("/lead/coordinators/c-1");
  });

  // AC5: a closed event has no reassign action
  it.each(["completed", "cancelled", "rejected"])("SCRUM-79/AC5 offers no reassign action for a %s event", async (status) => {
    const base = reassignment();
    mockFetch(200, reassignment({ event: { ...base.event, status }, canReassign: false, coordinators: [] }));

    await open();

    expect(screen.getByText("This event is closed, so its coordinator can't be changed.")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm reassignment" })).toBeNull();
  });
  // end of AC5

  it("SCRUM-79/AC1 offers no reassign action for an event with no coordinator yet", async () => {
    mockFetch(200, reassignment({ current: null, canReassign: false, coordinators: [] }));

    await open();

    expect(screen.getByText("This event has no coordinator yet. Assign one from the unassigned queue.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm reassignment" })).toBeNull();
  });

  // AC9: event-service refuses a non-Lead; the page shows the refusal and nothing to act on
  it("SCRUM-79/AC9 shows the refusal, and no way to reassign, when event-service denies access", async () => {
    mockFetch(403, { error: "Only an Event Coordinator Lead can do this." });

    await open();

    expect(screen.getByRole("alert").textContent).toBe("Only an Event Coordinator Lead can do this.");
    expect(screen.queryByRole("button", { name: "Confirm reassignment" })).toBeNull();
  });
  // end of AC9
});
// end of SCRUM-79
