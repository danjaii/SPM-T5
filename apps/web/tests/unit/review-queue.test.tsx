import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { replace, router } = vi.hoisted(() => {
  const replace = vi.fn();
  return { replace, router: { replace } }; // stable identity, like the real useRouter
});
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { ReviewQueue } from "@/components/ReviewQueue";

const ROWS = [
  { id: "1", name: "Annual Gala", status: "submitted", submitted_at: "2026-03-05T10:00:00Z", organiser_name: "Sam Tan" },
  { id: "2", name: "Tech Summit", status: "submitted", submitted_at: null, organiser_name: null },
];

type Reply = { status: number; body: unknown };

/** Fakes auth-service /auth/me and event-service /events. */
function mockServices({ me, events }: { me: Reply; events?: Reply }) {
  const fetchMock = vi.fn(async (url: string) => {
    const reply = url.includes("/auth/me") ? me : events!;
    return { ok: reply.status < 300, status: reply.status, json: async () => reply.body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const coordinator = { status: 200, body: { id: "u1", email: "c@x.com", fullName: "Casey", role: "event_coordinator" } };
const eventCalls = (fetchMock: ReturnType<typeof mockServices>) =>
  fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/events"));

beforeEach(() => replace.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-22/AC1 — coordinator sees submitted event requests", () => {
  it("shows a loading state, then the requests with organiser and status", async () => {
    mockServices({ me: coordinator, events: { status: 200, body: ROWS } });
    render(<ReviewQueue />);

    expect(screen.getByRole("status", { name: /loading/i })).toBeTruthy();
    await screen.findByText("Annual Gala");
    screen.getByText("Sam Tan");
    screen.getByText("Tech Summit");
    expect(screen.getAllByText("Submitted").length).toBeGreaterThan(0);
    screen.getByText("5 Mar 2026");
  });

  it("asks for the submitted status by default (SCRUM-22/AC4)", async () => {
    const fetchMock = mockServices({ me: coordinator, events: { status: 200, body: ROWS } });
    render(<ReviewQueue />);
    await screen.findByText("Annual Gala");
    expect(eventCalls(fetchMock)).toEqual(["http://localhost:4002/events?status=submitted"]);
  });

  it("shows an empty state when nothing matches", async () => {
    mockServices({ me: coordinator, events: { status: 200, body: [] } });
    render(<ReviewQueue />);
    await screen.findByText(/no event requests match/i);
  });

  it("shows the error with a retry that loads the list", async () => {
    let fail = true;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/auth/me")) return { ok: true, status: 200, json: async () => coordinator.body };
      return fail
        ? { ok: false, status: 500, json: async () => ({ error: "Boom." }) }
        : { ok: true, status: 200, json: async () => ROWS };
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ReviewQueue />);

    await screen.findByText("Boom.");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await screen.findByText("Annual Gala");
  });
});

describe("SCRUM-22/AC3 — search", () => {
  it("re-queries with the search text", async () => {
    const fetchMock = mockServices({ me: coordinator, events: { status: 200, body: ROWS } });
    render(<ReviewQueue />);
    await screen.findByText("Annual Gala");

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "gala" } });
    await waitFor(() =>
      expect(eventCalls(fetchMock).at(-1)).toBe("http://localhost:4002/events?status=submitted&search=gala"),
    );
  });
});

describe("SCRUM-22/AC5 — submission date range", () => {
  it("re-queries with the from and to dates", async () => {
    const fetchMock = mockServices({ me: coordinator, events: { status: 200, body: ROWS } });
    render(<ReviewQueue />);
    await screen.findByText("Annual Gala");

    fireEvent.change(screen.getByLabelText("Submitted from"), { target: { value: "2026-03-01" } });
    fireEvent.change(screen.getByLabelText("Submitted to"), { target: { value: "2026-03-31" } });
    await waitFor(() =>
      expect(eventCalls(fetchMock).at(-1)).toBe(
        "http://localhost:4002/events?status=submitted&from=2026-03-01&to=2026-03-31",
      ),
    );
  });

  it("warns instead of querying when from is after to", async () => {
    const fetchMock = mockServices({ me: coordinator, events: { status: 200, body: ROWS } });
    render(<ReviewQueue />);
    await screen.findByText("Annual Gala");

    fireEvent.change(screen.getByLabelText("Submitted to"), { target: { value: "2026-03-01" } });
    await waitFor(() => expect(eventCalls(fetchMock).length).toBe(2));
    fireEvent.change(screen.getByLabelText("Submitted from"), { target: { value: "2026-04-01" } });

    await screen.findByText(/must be on or before/i);
    expect(eventCalls(fetchMock).length).toBe(2); // the invalid range never reached event-service
  });
});

describe("SCRUM-22/AC2 — access control on the screen", () => {
  it("shows a friendly not-allowed state to other roles, without loading events", async () => {
    const fetchMock = mockServices({
      me: { status: 200, body: { id: "u2", email: "o@x.com", fullName: "Olly", role: "event_organiser" } },
    });
    render(<ReviewQueue />);
    await screen.findByText(/not allowed to view this page/i);
    expect(eventCalls(fetchMock)).toEqual([]);
  });

  it("shows the not-allowed state when event-service answers 403", async () => {
    mockServices({
      me: coordinator,
      events: { status: 403, body: { error: "You are not allowed to view submitted event requests." } },
    });
    render(<ReviewQueue />);
    await screen.findByText(/not allowed to view this page/i);
  });

  it("redirects to login when nobody is signed in (401 from auth-service)", async () => {
    mockServices({ me: { status: 401, body: { error: "Not signed in." } } });
    render(<ReviewQueue />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });

  it("redirects to login when the session expires (401 from event-service)", async () => {
    mockServices({ me: coordinator, events: { status: 401, body: { error: "Not signed in." } } });
    render(<ReviewQueue />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });
});

describe("SCRUM-23/AC1 — open a request from the list", () => {
  it("links each request to its details page", async () => {
    mockServices({ me: coordinator, events: { status: 200, body: ROWS } });
    render(<ReviewQueue />);

    const link = await screen.findByRole("link", { name: "Annual Gala" });
    expect(link.getAttribute("href")).toBe("/events/1");
    expect(screen.getByRole("link", { name: "Tech Summit" }).getAttribute("href")).toBe("/events/2");
  });
});
