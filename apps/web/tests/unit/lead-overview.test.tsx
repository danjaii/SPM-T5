import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookieValue, redirect } = vi.hoisted(() => ({
  cookieValue: { current: "token-lead" as string | undefined },
  redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));
vi.mock("next/navigation", () => ({ redirect }));

import CoordinatorOverviewPage, { dynamic as overviewDynamic } from "@/app/lead/coordinators/page";
import CoordinatorEventsPage, { dynamic as eventsDynamic } from "@/app/lead/coordinators/[id]/page";
import { LeadCoordinatorEvents } from "@/components/LeadCoordinatorEvents";
import { LeadCoordinatorList } from "@/components/LeadCoordinatorList";
import type { LeadCoordinator, LeadCoordinatorEvent } from "@/lib/leadServer";

const rachel: LeadCoordinator = { id: "c-1", full_name: "Rachel Tan", workload: 2 };
const marcus: LeadCoordinator = { id: "c-2", full_name: "Marcus Lim", workload: 0 };
const event = (over: Partial<LeadCoordinatorEvent> = {}): LeadCoordinatorEvent => ({
  id: "evt-1",
  name: "Tech Summit",
  status: "planning",
  preferred_start_datetime: "2031-06-15T01:00:00Z",
  preferred_end_datetime: "2031-06-15T09:00:00Z",
  expected_attendance: 120,
  ...over,
});

/** event-service answers each path with its own status and body. */
function mockServer(routes: Record<string, [number, unknown]>) {
  const fetchMock = vi.fn(async (url: string) => {
    const [status, body] = routes[new URL(url).pathname] ?? [404, { error: "Not found" }];
    return { ok: status < 400, status, json: async () => body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  cookieValue.current = "token-lead";
  redirect.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

const bodyRows = () => screen.getAllByRole("row").slice(1).map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent));

// ---------------------------------------------------------------------------
// SCRUM-81 — View coordinator workload and active events
// ---------------------------------------------------------------------------
describe("SCRUM-81 — Coordinator overview", () => {
  // AC1 + AC3: each coordinator with their workload count, including 0; each links to their events
  it("SCRUM-81/AC1 SCRUM-81/AC3 shows each coordinator with their workload count, including 0", () => {
    render(<LeadCoordinatorList coordinators={[rachel, marcus]} />);

    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Event Coordinator", "Active events"]);
    expect(bodyRows()).toEqual([["Rachel Tan", "2"], ["Marcus Lim", "0"]]);
    expect(screen.getByRole("link", { name: "Rachel Tan" }).getAttribute("href")).toBe("/lead/coordinators/c-1");
  });
  // end of AC1 + AC3

  // AC6: no coordinators says so clearly
  it("SCRUM-81/AC6 says no coordinators are assigned to the Lead when there are none", () => {
    render(<LeadCoordinatorList coordinators={[]} />);

    expect(screen.getByText("No coordinators are assigned to you.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
  // end of AC6

  // AC5: always loaded fresh, so opening or refreshing the page shows the current assignment
  it("SCRUM-81/AC5 loads the overview fresh from event-service every time it is opened", async () => {
    const fetchMock = mockServer({ "/lead/coordinators": [200, [rachel]] });

    render(await CoordinatorOverviewPage());

    expect(overviewDynamic).toBe("force-dynamic");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4002/lead/coordinators",
      expect.objectContaining({ headers: { cookie: "cs_session=token-lead" }, cache: "no-store" }),
    );
    expect(screen.getByRole("heading", { name: "Coordinator overview" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Rachel Tan" })).toBeTruthy();
  });
  // end of AC5

  // AC7: if event-service refuses, the page shows the refusal and no coordinators
  it("SCRUM-81/AC7 shows the refusal, and no coordinators, when event-service denies access", async () => {
    mockServer({ "/lead/coordinators": [403, { error: "Only an Event Coordinator Lead can do this." }] });

    render(await CoordinatorOverviewPage());

    expect(screen.getByRole("alert").textContent).toBe("Only an Event Coordinator Lead can do this.");
    expect(screen.queryByRole("table")).toBeNull();
  });
  // end of AC7
});

describe("SCRUM-81 — One coordinator's active events", () => {
  // AC2: each non-closed event with name, current status, preferred date and time, expected attendance
  it("SCRUM-81/AC2 shows each event's name, current status, preferred date and time and expected attendance", () => {
    render(<LeadCoordinatorEvents events={[event()]} />);

    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Event",
      "Status",
      "Preferred date and time",
      "Expected attendance",
    ]);
    expect(bodyRows()).toEqual([["Tech Summit", "Planning", "Sun, 15 Jun 2031, 9:00 AM – 5:00 PM", "120"]]);
  });

  it("SCRUM-81/AC3 says so when the coordinator has no active events", () => {
    render(<LeadCoordinatorEvents events={[]} />);

    expect(screen.getByText("This coordinator has no active events.")).toBeTruthy();
  });
  // end of AC2 + AC3

  it("SCRUM-81/AC2 SCRUM-81/AC5 loads the coordinator and their events fresh, and names the coordinator", async () => {
    const fetchMock = mockServer({
      "/lead/coordinators": [200, [rachel, marcus]],
      "/lead/coordinators/c-1/events": [200, [event()]],
    });

    render(await CoordinatorEventsPage({ params: Promise.resolve({ id: "c-1" }) }));

    expect(eventsDynamic).toBe("force-dynamic");
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:4002/lead/coordinators/c-1/events", expect.objectContaining({ cache: "no-store" }));
    expect(screen.getByRole("heading", { name: "Rachel Tan's active events" })).toBeTruthy();
    expect(screen.getByText("Tech Summit")).toBeTruthy();
  });

  // AC7: a coordinator the Lead doesn't supervise is refused by event-service; the page shows why
  it("SCRUM-81/AC7 shows the refusal for a coordinator the Lead does not supervise", async () => {
    mockServer({
      "/lead/coordinators": [200, [rachel]],
      "/lead/coordinators/c-9/events": [403, { error: "You can only view coordinators you supervise." }],
    });

    render(await CoordinatorEventsPage({ params: Promise.resolve({ id: "c-9" }) }));

    expect(screen.getByRole("alert").textContent).toBe("You can only view coordinators you supervise.");
    expect(screen.queryByRole("table")).toBeNull();
  });
  // end of AC7
});
// end of SCRUM-81
