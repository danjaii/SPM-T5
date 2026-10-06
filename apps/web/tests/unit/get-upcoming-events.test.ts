// this test file checks that the attendee dashboard can get the List of events from event-service

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stand-in for Next.js: the request's cookies
const { cookieValue } = vi.hoisted(() => ({
  cookieValue: { current: "token-123" as string | undefined },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));

import { getUpcomingEvents } from "@/lib/getUpcomingEvents";

/** Pretends event-service answered with this status code and JSON body. */
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
});

// ---------------------------------------------------------------------------
// SCRUM-71 — Loading the List of events from event-service
// ---------------------------------------------------------------------------
describe("SCRUM-71 — Loading upcoming events", () => {
  // AC1: the dashboard gets the list from event-service, as the signed-in user
  it("SCRUM-71/AC1 asks event-service for the upcoming events as the signed-in user", async () => {
    const events = [
      {
        id: "evt-1",
        name: "Tech Summit",
        start_at: "2026-12-12T11:00:00Z",
        end_at: "2026-12-12T13:00:00Z",
        venue: { name: "Orchid Hall", address: "Level 3, East Wing" },
      },
    ];
    const fetchMock = mockServer(200, events);

    await expect(getUpcomingEvents()).resolves.toEqual({ events });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4002/events/upcoming");
    expect(options.headers.cookie).toBe("cs_session=token-123");
  });
  // end of AC1
});
// end of SCRUM-71
