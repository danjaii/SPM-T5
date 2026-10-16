import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookieValue, redirect } = vi.hoisted(() => ({
  cookieValue: { current: "token-123" as string | undefined },
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));
vi.mock("next/navigation", () => ({ redirect }));

import { approveChangeRequest, rejectChangeRequest } from "@/lib/changeRequestReview";
import { getChangeRequestReview } from "@/lib/changeRequestReviewServer";

// SCRUM-67: fetching a change request's review on the server, and deciding it from the browser
// (docs/specs/review-change-request.md).

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

describe("SCRUM-67/AC2, AC7 getChangeRequestReview (67-S2, 67-S9)", () => {
  it("67-S2: asks event-service as the signed-in user and gives the review", async () => {
    const fetchMock = mockServer(200, { id: "cr 1" });

    expect(await getChangeRequestReview("cr 1")).toEqual({ review: { id: "cr 1" } });
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:4002/change-requests/cr%201");
    expect(fetchMock.mock.calls[0][1].headers.cookie).toContain("token-123");
    expect(fetchMock.mock.calls[0][1].cache).toBe("no-store");
  });

  it("67-S9: a refusal in event-service's words, or a general one; no network says so", async () => {
    mockServer(403, { error: "Only the event's assigned coordinator can review its change requests." });
    expect(await getChangeRequestReview("cr-1")).toEqual({ error: "Only the event's assigned coordinator can review its change requests." });
    mockServer(500, {});
    expect(await getChangeRequestReview("cr-1")).toEqual({ error: "We couldn't load the change request." });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await getChangeRequestReview("cr-1")).toEqual({ error: "We couldn't reach the server. Please try again." });
  });

  it("67-S9: no session, or an expired one, goes to sign in", async () => {
    mockServer(401, {});
    await expect(getChangeRequestReview("cr-1")).rejects.toThrow("redirect:/login");
    cookieValue.current = undefined;
    await expect(getChangeRequestReview("cr-1")).rejects.toThrow("redirect:/login");
  });
});

describe("SCRUM-67/AC3, AC5 deciding from the browser (67-S3, 67-S7)", () => {
  it("67-S3, 67-S7: approve and reject post to event-service with the session cookie; no network says so", async () => {
    const fetchMock = mockServer(200, { status: "approved" });
    expect(await approveChangeRequest("cr-1")).toEqual({ ok: true, data: { status: "approved" } });
    await rejectChangeRequest("cr-1", "Too late");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", credentials: "include", body: "{}" });
    expect(fetchMock.mock.calls[1][1].body).toBe(JSON.stringify({ reason: "Too late" }));

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await approveChangeRequest("cr-1")).toEqual({ ok: false, data: { error: "We couldn't reach the server. Please try again." } });
  });
});
