// SCRUM-52/AC1: the organiser's My event requests page loads its list from event-service as the signed-in user

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookieValue, redirect } = vi.hoisted(() => ({
  cookieValue: { current: "token-123" as string | undefined },
  redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));
vi.mock("next/navigation", () => ({ redirect }));

import { getMyEventRequests } from "@/lib/myEventRequestsServer";

function mockServer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  cookieValue.current = "token-123";
  redirect.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-52/AC1 loading my event requests", () => {
  it("SCRUM-52/AC1 asks event-service for the signed-in organiser's requests", async () => {
    const requests = [{ id: "evt-1", name: "Tech Summit", status: "submitted" }];
    const fetchMock = mockServer(200, requests);

    await expect(getMyEventRequests()).resolves.toEqual({ requests });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4002/events/my-requests");
    expect(options.headers.cookie).toBe("cs_session=token-123");
  });

  it("SCRUM-52/AC1 sends someone who is not signed in to the sign-in page", async () => {
    cookieValue.current = undefined;
    mockServer(200, []);

    await expect(getMyEventRequests()).rejects.toThrow("redirect:/login");
  });

  it("SCRUM-52/AC1 sends an expired session to the sign-in page", async () => {
    mockServer(401, { error: "Not signed in." });

    await expect(getMyEventRequests()).rejects.toThrow("redirect:/login");
  });

  it("SCRUM-52/AC1 passes on event-service's refusal for a role that may not see the list", async () => {
    mockServer(403, { error: "You are not allowed to view event requests created by organisers." });

    await expect(getMyEventRequests()).resolves.toEqual({ error: "You are not allowed to view event requests created by organisers." });
  });

  it("SCRUM-52/AC1 says so when event-service answers without a message", async () => {
    mockServer(500, {});

    await expect(getMyEventRequests()).resolves.toEqual({ error: "We couldn't load your event requests. Please try again." });
  });

  it("SCRUM-52/AC1 says so when event-service cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));

    await expect(getMyEventRequests()).resolves.toEqual({ error: "We couldn't reach the server. Please try again." });
  });

  // A body that is not JSON (an HTML error page from a proxy, say) must read as a failed load, never as a list the page then
  // calls .map on
  const NOT_LOADED = { error: "We couldn't load your event requests. Please try again." };
  const answerWithBadBody = (status: number) =>
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => { throw new SyntaxError("Unexpected token <"); } }));

  it("SCRUM-52/AC1 treats a 200 whose body is not JSON as a failed load, not as a list", async () => {
    answerWithBadBody(200);

    await expect(getMyEventRequests()).resolves.toEqual(NOT_LOADED);
  });

  it("SCRUM-52/AC1 treats a 200 whose JSON is not a list as a failed load", async () => {
    mockServer(200, { unexpected: true });

    await expect(getMyEventRequests()).resolves.toEqual(NOT_LOADED);
  });

  it("SCRUM-52/AC1 treats an error page that is not JSON as a failed load", async () => {
    answerWithBadBody(502);

    await expect(getMyEventRequests()).resolves.toEqual(NOT_LOADED);
  });
});
