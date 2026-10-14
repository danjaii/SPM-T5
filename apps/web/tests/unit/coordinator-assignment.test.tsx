import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CoordinatorAssignment, NO_HISTORY } from "@/components/CoordinatorAssignment";

// SCRUM-78/SCRUM-79: a Lead now assigns and reassigns from the Lead's pages, so this component only shows the coordinator
// and the history. Its SCRUM-41/42 claim, reassign, "no eligible coordinator" and authorisation tests were retired;
// SCRUM-79/AC9 at the bottom checks it offers no assign or reassign action.

type Reply = { status: number; body: unknown };

/** Fakes event-service's assignment history. */
function mockEventService(replies: { history?: Reply }) {
  const fetchMock = vi.fn(async (_url: string) => {
    const reply = replies.history ?? { status: 200, body: [] };
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const setup = (props: Partial<Parameters<typeof CoordinatorAssignment>[0]> = {}) =>
  render(<CoordinatorAssignment eventId="evt-1" coordinatorName={null} {...props} />);

afterEach(() => vi.unstubAllGlobals());

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
    setup({ coordinatorName: "Bob Coord" });

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

});

// ---------------------------------------------------------------------------
// SCRUM-78/AC9 + SCRUM-79/AC9 — Only an Event Coordinator Lead assigns or reassigns (from the Lead's pages). The event
// page still shows who is assigned and the history, but offers nobody an assign or reassign action.
// ---------------------------------------------------------------------------
describe("SCRUM-79/AC9 — No assign or reassign action on the event page", () => {
  it.each([null, "Alice Coord"])("SCRUM-79/AC9 shows the coordinator (%s) and the history, with no assign or reassign action", async (name) => {
    const fetchMock = mockEventService({});
    render(<CoordinatorAssignment eventId="evt-1" coordinatorName={name} />);

    expect(await screen.findByText(NO_HISTORY)).toBeTruthy();
    expect(screen.getByText(name ?? "Not yet assigned")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(["http://localhost:4002/events/evt-1/assignment-history"]);
  });
});
