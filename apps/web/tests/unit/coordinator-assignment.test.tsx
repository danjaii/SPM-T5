import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { CoordinatorAssignment, NO_ELIGIBLE, NO_HISTORY } from "@/components/CoordinatorAssignment";

type Reply = { status: number; body: unknown };

/** Fakes event-service: each route answers with its own reply. */
function mockEventService(replies: { history?: Reply; eligible?: Reply; assign?: Reply }) {
  const fetchMock = vi.fn(async (url: string) => {
    const reply = url.endsWith("/assignment-history")
      ? replies.history ?? { status: 200, body: [] }
      : url.endsWith("/eligible-coordinators")
        ? replies.eligible!
        : replies.assign!;
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** What event-service offers when the event is unassigned: just the caller (SCRUM-42 claim). */
const ME = [{ id: "c-me", full_name: "Rachel Tan" }];
/** What it offers the assigned coordinator when reassigning: everyone else (SCRUM-41/AC2). */
const OTHERS = [
  { id: "c-bob", full_name: "Bob Coord" },
  { id: "c-carol", full_name: "Carol Coord" },
];

const setup = (props: Partial<Parameters<typeof CoordinatorAssignment>[0]> = {}) =>
  render(<CoordinatorAssignment eventId="evt-1" coordinatorName={null} canAssign {...props} />);
const setupAssigned = (props: Partial<Parameters<typeof CoordinatorAssignment>[0]> = {}) =>
  setup({ coordinatorName: "Alice Coord", ...props });

const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const bodyOf = (fetchMock: ReturnType<typeof mockEventService>, suffix: string) => {
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith(suffix))!;
  return JSON.parse(((call as unknown[])[1] as RequestInit).body as string);
};

beforeEach(() => refresh.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-42 — Claim an unassigned event", () => {
  it("AC1, AC3: asks for confirmation, then assigns the event to the viewer", async () => {
    const fetchMock = mockEventService({
      eligible: { status: 200, body: ME },
      assign: { status: 200, body: { assigned_coordinator_id: "c-me" } },
    });
    setup();

    expect(screen.getByText("Not yet assigned")).toBeTruthy();
    click("Assign to me");
    expect(await screen.findByText(/Assign this event to yourself\?/)).toBeTruthy();
    expect(screen.queryByLabelText("New coordinator")).toBeNull(); // nobody else to choose
    click("Confirm assignment");

    expect(await screen.findByText("Rachel Tan", { selector: "p" })).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
    expect(bodyOf(fetchMock, "/assign-coordinator")).toEqual({ coordinator_id: "c-me" });
  });

  it("cancelling assigns nobody", async () => {
    const fetchMock = mockEventService({ eligible: { status: 200, body: ME } });
    setup();

    click("Assign to me");
    await screen.findByText(/Assign this event to yourself\?/);
    click("Cancel");

    expect(screen.getByText("Not yet assigned")).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/assign-coordinator"))).toBe(false);
  });

  it("shows the server's message when it can't start", async () => {
    mockEventService({ eligible: { status: 403, body: { error: "You are not allowed to view eligible coordinators." } } });
    setup();

    click("Assign to me");

    expect((await screen.findByRole("alert")).textContent).toBe("You are not allowed to view eligible coordinators.");
  });
});

describe("SCRUM-41 — Reassign to another coordinator", () => {
  it("AC1, AC2: lists the other eligible coordinators", async () => {
    const fetchMock = mockEventService({ eligible: { status: 200, body: OTHERS } });
    setupAssigned();

    expect(screen.getByText("Alice Coord")).toBeTruthy();
    click("Reassign coordinator");

    const select = await screen.findByLabelText("New coordinator");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Bob Coord", "Carol Coord"]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toContain("http://localhost:4002/events/evt-1/eligible-coordinators");
  });

  it("AC3: reassigns to the chosen coordinator after confirming", async () => {
    const fetchMock = mockEventService({
      eligible: { status: 200, body: OTHERS },
      assign: { status: 200, body: { assigned_coordinator_id: "c-carol" } },
    });
    setupAssigned();

    click("Reassign coordinator");
    fireEvent.change(await screen.findByLabelText("New coordinator"), { target: { value: "c-carol" } });
    click("Confirm assignment");

    expect(await screen.findByText("Carol Coord", { selector: "p" })).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
    expect(bodyOf(fetchMock, "/assign-coordinator")).toEqual({ coordinator_id: "c-carol" });
  });

  it("shows the server's refusal and keeps the current coordinator", async () => {
    mockEventService({
      eligible: { status: 200, body: OTHERS },
      assign: { status: 403, body: { error: "Only the coordinator assigned to this event can reassign it." } },
    });
    setupAssigned();

    click("Reassign coordinator");
    await screen.findByLabelText("New coordinator");
    click("Confirm assignment");

    expect((await screen.findByRole("alert")).textContent).toBe("Only the coordinator assigned to this event can reassign it.");
    expect(screen.getByText("Alice Coord")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("SCRUM-42/AC7, SCRUM-41/AC8 — No eligible coordinator", () => {
  it("says nobody is available and keeps the current coordinator", async () => {
    mockEventService({ eligible: { status: 200, body: [] } });
    setupAssigned();

    click("Reassign coordinator");

    expect((await screen.findByText(NO_ELIGIBLE, { exact: false })).textContent).toContain(NO_ELIGIBLE);
    expect(screen.getByText("Alice Coord")).toBeTruthy();
    click("Close");
    screen.getByRole("button", { name: "Reassign coordinator" });
  });
});

describe("SCRUM-42/AC8, SCRUM-41/AC9 — Authorisation", () => {
  it("offers no assignment action to someone who may not assign", () => {
    mockEventService({});
    setupAssigned({ canAssign: false });

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Alice Coord")).toBeTruthy();
  });
});

describe("SCRUM-43 — Assignment history", () => {
  it("AC1, AC2, AC3: lists each change with names, oldest first", async () => {
    mockEventService({
      history: {
        status: 200,
        body: [
          { coordinator_id: "c-alice", previous_coordinator_id: null, assigned_by: "c-alice", assigned_at: "2026-09-01T02:00:00Z",
            coordinator_name: "Alice Coord", previous_coordinator_name: null, assigned_by_name: "Alice Coord" },
          { coordinator_id: "c-bob", previous_coordinator_id: "c-alice", assigned_by: "c-alice", assigned_at: "2026-09-03T02:00:00Z",
            coordinator_name: "Bob Coord", previous_coordinator_name: "Alice Coord", assigned_by_name: "Alice Coord" },
        ],
      },
    });
    setup({ canAssign: false, coordinatorName: "Bob Coord" });

    const rows = await screen.findAllByRole("row");
    expect(rows.map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent))).toEqual([
      [],
      [expect.stringMatching(/1 Sept? 2026/), "Alice Coord", "—", "Alice Coord"],
      [expect.stringMatching(/3 Sept? 2026/), "Bob Coord", "Alice Coord", "Alice Coord"],
    ]);
  });

  it("says when nobody has been assigned yet", async () => {
    mockEventService({});
    setup();

    expect(await screen.findByText(NO_HISTORY)).toBeTruthy();
  });

  it("reloads the history after an assignment", async () => {
    const fetchMock = mockEventService({
      eligible: { status: 200, body: ME },
      assign: { status: 200, body: { assigned_coordinator_id: "c-me" } },
    });
    setup();
    await screen.findByText(NO_HISTORY);

    click("Assign to me");
    await screen.findByText(/Assign this event to yourself\?/);
    click("Confirm assignment");

    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/assignment-history"))).toHaveLength(2),
    );
  });
});
