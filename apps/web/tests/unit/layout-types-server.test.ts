import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stand-ins for Next.js: the request's cookies, and redirect() (which stops the page by throwing).
const { cookieValue, redirect, shell } = vi.hoisted(() => ({
  cookieValue: { current: "token-123" as string | undefined },
  redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }),
  shell: { current: { user: { fullName: "Kenneth Wong", role: "venue_staff" }, counts: {} } as unknown },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/shellServer", () => ({ getShellData: async () => shell.current }));

import { canManageLayoutTypes, getLayoutTypes } from "@/lib/layoutTypesServer";

function mockServer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  cookieValue.current = "token-123";
  shell.current = { user: { fullName: "Kenneth Wong", role: "venue_staff" }, counts: {} };
  redirect.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-181/AC6 who is offered the layout type actions (181-S6)", () => {
  it("181-S6: venue staff may manage layout types; every other role, and a visitor, may not", async () => {
    expect(await canManageLayoutTypes()).toBe(true);

    for (const role of ["event_coordinator", "event_organiser", "technical_support_staff", "attendee", "safety_officer", "event_coordinator_lead"]) {
      shell.current = { user: { fullName: "Someone", role }, counts: {} };
      expect(await canManageLayoutTypes()).toBe(false);
    }

    shell.current = null;
    expect(await canManageLayoutTypes()).toBe(false);
  });
});

describe("SCRUM-181/AC1 loading the layout types (181-S1)", () => {
  it("181-S1: asks venue-service for the list as the signed-in user", async () => {
    const list = [{ id: "l1", name: "Theatre", isActive: true, venueCount: 2 }];
    const fetchMock = mockServer(200, list);

    expect(await getLayoutTypes()).toEqual({ layoutTypes: list });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/layout-types$/),
      expect.objectContaining({ headers: { cookie: "cs_session=token-123" }, cache: "no-store" }),
    );
  });

  it("181-S6: the service's own reason is passed on, and a reply with no reason gets a plain one", async () => {
    mockServer(403, { error: "Only venue staff can manage layout types." });
    expect(await getLayoutTypes()).toEqual({ error: "Only venue staff can manage layout types." });

    mockServer(500, {});
    expect(await getLayoutTypes()).toEqual({ error: "We couldn't load the layout types." });
  });

  it("181-S1: an unreachable service says so", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await getLayoutTypes()).toEqual({ error: "We couldn't reach the venue service. Please try again." });
  });

  it("181-S6: nobody signed in goes to the sign-in page without asking the service, and so does an expired login", async () => {
    cookieValue.current = undefined;
    const fetchMock = mockServer(200, []);
    await expect(getLayoutTypes()).rejects.toThrow("redirect:/login");
    expect(fetchMock).not.toHaveBeenCalled();

    cookieValue.current = "token-123";
    mockServer(401, {});
    await expect(getLayoutTypes()).rejects.toThrow("redirect:/login");
  });
});
