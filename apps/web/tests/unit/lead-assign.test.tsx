import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookieValue, redirect, refresh } = vi.hoisted(() => ({
  cookieValue: { current: "token-lead" as string | undefined },
  redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }),
  refresh: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));
vi.mock("next/navigation", () => ({ redirect, useRouter: () => ({ refresh }) }));

import LeadAssignPage from "@/app/lead/events/[id]/assign/page";
import { LeadAssignForm } from "@/components/LeadAssignForm";
import { LeadQueueList } from "@/components/LeadQueueList";
import type { LeadCoordinatorChoice, LeadQueueItem } from "@/lib/leadServer";

const rachel: LeadCoordinatorChoice = { id: "c-1", full_name: "Rachel Tan", workload: 2, total_attendance: 150, clash: { status: "free" } };
const marcus: LeadCoordinatorChoice = { id: "c-2", full_name: "Marcus Lim", workload: 0, total_attendance: 0, clash: { status: "free" } };
const queueItem: LeadQueueItem = {
  id: "evt-1",
  name: "Tech Summit",
  organiser_name: "Jason Chua",
  preferred_start_datetime: "2031-06-15T01:00:00Z",
  preferred_end_datetime: "2031-06-15T09:00:00Z",
  expected_attendance: 120,
  submitted_at: "2031-01-02T03:04:00Z",
};
const assignment = (over: Record<string, unknown> = {}) => ({
  event: { ...queueItem, status: "submitted" },
  canAssign: true,
  coordinators: [rachel, marcus],
  ...over,
});

/** The browser's POST to event-service answers with this status and body. */
function mockPost(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** SCRUM-168: picks a coordinator from the list by name, as the Lead does by clicking their row. */
async function choose(label: string) {
  fireEvent.click(screen.getByRole("radio", { name: new RegExp(label.split(" — ")[0]) }));
}

const renderForm = (coordinators = [rachel, marcus]) =>
  render(<LeadAssignForm eventId="evt-1" eventName="Tech Summit" coordinators={coordinators} />);

beforeEach(() => {
  cookieValue.current = "token-lead";
  redirect.mockClear();
  refresh.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------------------
// SCRUM-78 — Manually assign an Event Coordinator
// ---------------------------------------------------------------------------
describe("SCRUM-78 — Assign an Event Coordinator", () => {
  // AC1: from the queue, the Lead chooses to assign a request
  it("SCRUM-78/AC1 each request in the queue has an Assign action", () => {
    render(<LeadQueueList requests={[queueItem]} />);

    expect(screen.getByRole("link", { name: "Assign Tech Summit" }).getAttribute("href")).toBe("/lead/events/evt-1/assign");
  });

  // AC1: the eligible coordinators are listed, each with their workload count
  it("SCRUM-78/AC1 SCRUM-126/AC2 lists the eligible coordinators, each with their workload count", () => {
    renderForm();

    expect(screen.getByRole("radio", { name: /Rachel Tan/ }).closest("label")!.textContent).toContain("2 active events");
    expect(screen.getByRole("radio", { name: /Marcus Lim/ }).closest("label")!.textContent).toContain("0 active events");
  });
  // end of AC1

  // AC2 + AC3: confirming assigns the chosen coordinator, and the Lead sees it is now assigned
  it("SCRUM-78/AC2 SCRUM-78/AC3 assigns the chosen coordinator on confirm and shows the event as assigned", async () => {
    const fetchMock = mockPost(200, { assigned_coordinator_id: "c-2" });
    renderForm();

    await choose("Marcus Lim — 0 active events");
    fireEvent.click(screen.getByRole("button", { name: "Confirm assignment" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Tech Summit is now assigned to Marcus Lim. Marcus Lim has been notified."));
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4002/lead/events/evt-1/assign",
      expect.objectContaining({ method: "POST", credentials: "include", body: JSON.stringify({ coordinator_id: "c-2" }) }),
    );
    expect(screen.queryByRole("button", { name: "Confirm assignment" })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to unassigned event requests" }).getAttribute("href")).toBe("/lead/queue");
  });

  it("SCRUM-78/AC2 does not confirm until a coordinator is chosen", () => {
    const fetchMock = mockPost(200, {});
    renderForm();

    expect((screen.getByRole("button", { name: "Confirm assignment" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Confirm assignment" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
  // end of AC2 + AC3

  // AC5: someone else assigned it first; the Lead is told, and theirs is not shown as done
  it("SCRUM-78/AC5 tells the Lead the event is already assigned when someone else got there first", async () => {
    mockPost(409, { error: "This event has already been assigned to a coordinator." });
    renderForm();

    await choose("Rachel Tan — 2 active events");
    fireEvent.click(screen.getByRole("button", { name: "Confirm assignment" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("This event has already been assigned to a coordinator."));
    expect(screen.queryByRole("status")).toBeNull();
  });
  // end of AC5

  // AC7: no eligible coordinators: told so, and no way to confirm
  it("SCRUM-78/AC7 says no coordinators are available, and offers no confirm, when there are none", () => {
    renderForm([]);

    expect(screen.getByText("No eligible coordinators are available.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm assignment" })).toBeNull();
  });
  // end of AC7

  // AC8: cancelling before confirming leaves the event unassigned (nothing is sent)
  it("SCRUM-78/AC8 cancelling before confirming sends nothing and returns to the queue", async () => {
    const fetchMock = mockPost(200, {});
    renderForm();

    await choose("Rachel Tan — 2 active events");
    const cancel = screen.getByRole("link", { name: "Cancel" });

    expect(cancel.getAttribute("href")).toBe("/lead/queue");
    // jsdom cannot open another page, so stop the browser following the link; we only check nothing was sent
    cancel.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(cancel);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  // end of AC8
});

describe("SCRUM-78 — The assign page", () => {
  /** event-service answers the server-side GET with this status and body. */
  const mockServer = (status: number, body: unknown) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };
  const open = async (id = "evt-1") => render(await LeadAssignPage({ params: Promise.resolve({ id }) }));

  it("SCRUM-78/AC1 loads the event and its eligible coordinators as the signed-in Lead", async () => {
    const fetchMock = mockServer(200, assignment());

    await open();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4002/lead/events/evt-1/assignment",
      expect.objectContaining({ headers: { cookie: "cs_session=token-lead" }, cache: "no-store" }),
    );
    expect(screen.getByRole("heading", { name: "Assign a coordinator to Tech Summit" })).toBeTruthy();
    expect(screen.getByText("Jason Chua")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Event Coordinator" })).toBeTruthy();
  });

  // AC6: a closed event has no assign action
  it.each(["completed", "cancelled", "rejected"])("SCRUM-78/AC6 offers no assign action for a %s event", async (status) => {
    mockServer(200, assignment({ event: { ...queueItem, status }, canAssign: false, coordinators: [] }));

    await open();

    expect(screen.getByText("This event is closed, so a coordinator can't be assigned.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm assignment" })).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("SCRUM-78/AC3 offers no assign action for an event that already has a coordinator", async () => {
    mockServer(200, assignment({ canAssign: false, coordinators: [] }));

    await open();

    expect(screen.getByText("This event already has a coordinator.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm assignment" })).toBeNull();
  });
  // end of AC6

  // AC9: event-service refuses a non-Lead; the page shows the refusal and nothing to act on
  it("SCRUM-78/AC9 shows the refusal, and no way to assign, when event-service denies access", async () => {
    mockServer(403, { error: "Only an Event Coordinator Lead can do this." });

    await open();

    expect(screen.getByRole("alert").textContent).toBe("Only an Event Coordinator Lead can do this.");
    expect(screen.queryByRole("button", { name: "Confirm assignment" })).toBeNull();
  });
  // end of AC9
});
// end of SCRUM-78
