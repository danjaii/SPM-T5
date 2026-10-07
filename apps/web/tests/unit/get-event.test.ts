import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stand-ins for Next.js: the request's cookies, and redirect() (which stops the page by throwing).
const { cookieValue, redirect } = vi.hoisted(() => ({
  cookieValue: { current: "token-123" as string | undefined },
  redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));
vi.mock("next/navigation", () => ({ redirect }));

import { getEvent, getEventOutcome } from "@/lib/getEvent";

function mockServer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  cookieValue.current = "token-123";
  redirect.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Loading an event for the event status page", () => {
  it("asks event-service for the event as the signed-in user", async () => {
    const event = { id: "evt-1", name: "Tech Summit", status: "under_review", canChangeStatus: true };
    const fetchMock = mockServer(200, event);

    await expect(getEvent("evt-1")).resolves.toEqual({ event });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4002/events/evt-1");
    expect(options.headers.cookie).toBe("cs_session=token-123");
  });

  it("sends visitors who aren't signed in to the sign-in page", async () => {
    cookieValue.current = undefined;
    await expect(getEvent("evt-1")).rejects.toThrow("redirect:/login");

    cookieValue.current = "expired-token";
    mockServer(401, { error: "Not signed in." });
    await expect(getEvent("evt-1")).rejects.toThrow("redirect:/login");
  });

  it("passes on event-service's message when the viewer isn't allowed or the event doesn't exist", async () => {
    mockServer(403, { error: "You are not allowed to view this event's status." });
    await expect(getEvent("evt-1")).resolves.toEqual({ error: "You are not allowed to view this event's status." });

    mockServer(404, { error: "Event not found." });
    await expect(getEvent("evt-1")).resolves.toEqual({ error: "Event not found." });
  });
});

describe("SCRUM-44 — loading the review outcome", () => {
  const decision = { outcome: "approved", decided_at: "2026-09-02T03:00:00Z", reason: null, decided_by_name: "Rachel Tan" };

  it("asks event-service for the outcome as the signed-in user", async () => {
    const fetchMock = mockServer(200, { decision });

    expect(await getEventOutcome("evt 1")).toEqual(decision);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4002/events/evt%201/outcome");
    expect(options.headers).toEqual({ cookie: "cs_session=token-123" });
  });

  it("AC5: returns null when there is no decision yet", async () => {
    mockServer(200, { decision: null });
    expect(await getEventOutcome("evt-1")).toBeNull();
  });

  it("AC6: returns null rather than an error when the viewer may not see it", async () => {
    mockServer(404, { error: "Event not found." });
    expect(await getEventOutcome("evt-1")).toBeNull();
  });

  it("returns null when event-service can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await getEventOutcome("evt-1")).toBeNull();
  });

  it("sends visitors who aren't signed in to the sign-in page", async () => {
    cookieValue.current = undefined;
    await expect(getEventOutcome("evt-1")).rejects.toThrow("redirect:/login");
  });
});
