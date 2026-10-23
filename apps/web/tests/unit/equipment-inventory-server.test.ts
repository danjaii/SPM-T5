import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stand-ins for Next.js: the request's cookies, and redirect() (which stops the page by throwing).
const { cookieValue, redirect } = vi.hoisted(() => ({
  cookieValue: { current: "token-123" as string | undefined },
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));
vi.mock("next/navigation", () => ({ redirect }));

import { getEquipmentInventory } from "@/lib/equipmentInventoryServer";

// ----------------------------------------------------------------------------
// Test setup: a pretend equipment-service answer for 15 Oct 2026, 09:00 to 17:00
// ----------------------------------------------------------------------------

const PERIOD = { date: "2026-10-15", startTime: "09:00", endTime: "17:00" };
const items = [{ id: "eq-projector", name: "Projector Unit", type: "AV", total: 10, available: 6, heldBy: [], outOfService: null }];

/** Pretends equipment-service answers with this status and JSON body; `null` makes the request itself fail. */
function mockServer(reply: { status: number; body: unknown } | null) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(async () => {
    if (!reply) throw new TypeError("fetch failed");
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.body };
  });
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

// end of test setup

describe("SCRUM-137/AC2 loading the inventory from equipment-service", () => {
  it("asks for the period with the login cookie and returns the items", async () => {
    const fetchMock = mockServer({ status: 200, body: items });
    expect(await getEquipmentInventory(PERIOD)).toEqual({ items });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4004/equipment-inventory?date=2026-10-15&startTime=09%3A00&endTime=17%3A00");
    expect((init?.headers as Record<string, string>).cookie).toBe("cs_session=token-123");
  });

  it("returns the field messages for a period equipment-service refuses", async () => {
    mockServer({ status: 422, body: { error: "Please check the highlighted fields.", fieldErrors: { date: "Please enter a date." } } });
    expect(await getEquipmentInventory(PERIOD)).toEqual({ fieldErrors: { date: "Please enter a date." } });
  });
});

describe("SCRUM-137/AC9 inventory loading errors", () => {
  it("passes on equipment-service's refusal for another role", async () => {
    mockServer({ status: 403, body: { error: "Only Technical Support Staff can check equipment." } });
    expect(await getEquipmentInventory(PERIOD)).toEqual({ error: "Only Technical Support Staff can check equipment." });
  });

  it("says something went wrong when the refusal has no message", async () => {
    mockServer({ status: 500, body: {} });
    expect(await getEquipmentInventory(PERIOD)).toEqual({ error: "Something went wrong. Please try again." });
  });

  it("says the service could not be reached when the request fails", async () => {
    mockServer(null);
    expect(await getEquipmentInventory(PERIOD)).toEqual({ error: "We couldn't reach the equipment service. Please try again." });
  });

  it("sends someone without a session, or with an expired one, to sign in", async () => {
    cookieValue.current = undefined;
    await expect(getEquipmentInventory(PERIOD)).rejects.toThrow("redirect:/login");

    cookieValue.current = "token-123";
    mockServer({ status: 401, body: {} });
    await expect(getEquipmentInventory(PERIOD)).rejects.toThrow("redirect:/login");
  });
});
