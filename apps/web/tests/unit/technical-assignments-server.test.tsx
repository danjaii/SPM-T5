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

import { getEventTechnicalAssignments, getTechnicalAssignmentForm } from "@/lib/technicalAssignmentsServer";

// SCRUM-20: the server-side fetch of an event's on-site assignments (docs/specs/technical-assignment-notifications.md).

const DATA = { assignments: [], canAssign: true, staff: [], venues: [] };

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

describe("SCRUM-20/AC5 getEventTechnicalAssignments (20-S10)", () => {
  it("20-S10: asks equipment-service for the event's assignments as the signed-in user", async () => {
    const fetchMock = mockServer(200, DATA);

    expect(await getEventTechnicalAssignments("evt 1")).toEqual(DATA);
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:4004/events/evt%201/technical-assignments");
    expect(fetchMock.mock.calls[0][1].headers.cookie).toContain("token-123");
    expect(fetchMock.mock.calls[0][1].cache).toBe("no-store");
  });

  it("20-S10: null on a refusal, a network failure or no session, so the event page leaves the section out", async () => {
    mockServer(403, { error: "no" });
    expect(await getEventTechnicalAssignments("evt-1")).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await getEventTechnicalAssignments("evt-1")).toBeNull();
    cookieValue.current = undefined;
    const fetchMock = mockServer(200, DATA);
    expect(await getEventTechnicalAssignments("evt-1")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SCRUM-20/AC1 getTechnicalAssignmentForm (20-S12)", () => {
  it("20-S12: gives the data, or equipment-service's refusal in its own words", async () => {
    mockServer(200, DATA);
    expect(await getTechnicalAssignmentForm("evt-1")).toEqual({ data: DATA });
    mockServer(403, { error: "You are not allowed to do that." });
    expect(await getTechnicalAssignmentForm("evt-1")).toEqual({ error: "You are not allowed to do that." });
    mockServer(500, {});
    expect(await getTechnicalAssignmentForm("evt-1")).toEqual({ error: "We couldn't load the on-site assignments." });
  });

  it("20-S12: a network failure says so; no session, or an expired one, goes to sign in", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await getTechnicalAssignmentForm("evt-1")).toEqual({ error: "We couldn't reach the server. Please try again." });

    mockServer(401, {});
    await expect(getTechnicalAssignmentForm("evt-1")).rejects.toThrow("redirect:/login");
    cookieValue.current = undefined;
    await expect(getTechnicalAssignmentForm("evt-1")).rejects.toThrow("redirect:/login");
  });
});
