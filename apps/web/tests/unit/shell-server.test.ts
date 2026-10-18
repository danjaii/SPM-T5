import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ token: "tok" as string | undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (store.token ? { value: store.token } : undefined) }) }));

import { getShellData } from "@/lib/shellServer";

const json = (body: unknown, ok = true) => ({ ok, json: async () => body });
function services(role: string, queues: Record<string, unknown> = {}) {
  return vi.fn(async (url: string) => {
    if (url.endsWith("/auth/me")) return json({ fullName: "Sam Lee", role });
    for (const [path, body] of Object.entries(queues)) if (url.endsWith(path)) return body;
    return json({}, false);
  });
}

beforeEach(() => {
  store.token = "tok";
});
afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-121/AC2 shell data", () => {
  it.each([
    ["event_coordinator_lead", "/lead/queue", [{}, {}, {}], { leadQueue: 3 }],
    ["venue_staff", "/booking-queue", [{}], { bookingQueue: 1 }],
    ["technical_support_staff", "/equipment-requests", [{}, {}], { equipmentQueue: 2 }],
    ["safety_officer", "/safety-checks", [{}, {}, {}, {}], { safetyQueue: 4 }],
  ])("counts the %s's queue", async (role, path, body, counts) => {
    vi.stubGlobal("fetch", services(role, { [path]: json(body) }));
    expect(await getShellData()).toEqual({ user: { fullName: "Sam Lee", role }, counts });
  });

  it("leaves the count out when a queue answers with something other than a list", async () => {
    vi.stubGlobal("fetch", services("venue_staff", { "/booking-queue": json({ requests: [{}] }) }));
    expect((await getShellData())?.counts).toEqual({});
  });

  it("asks for no queue when the role has none", async () => {
    const fetchMock = services("attendee");
    vi.stubGlobal("fetch", fetchMock);
    expect((await getShellData())?.counts).toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves the count out when the queue service fails, so the page still loads", async () => {
    vi.stubGlobal("fetch", services("venue_staff", { "/booking-queue": json({}, false) }));
    expect((await getShellData())?.counts).toEqual({});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth/me")) return json({ fullName: "S", role: "venue_staff" });
        throw new Error("down");
      }),
    );
    expect((await getShellData())?.counts).toEqual({});
  });

  it("returns null when nobody is signed in, the session is refused, or the role is unknown", async () => {
    store.token = undefined;
    expect(await getShellData()).toBeNull();
    store.token = "tok";
    vi.stubGlobal("fetch", vi.fn(async () => json({}, false)));
    expect(await getShellData()).toBeNull();
    vi.stubGlobal("fetch", services("wizard"));
    expect(await getShellData()).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect(await getShellData()).toBeNull();
  });
});
