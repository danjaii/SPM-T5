import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stand-ins for Next.js: the request's cookies, and redirect() (which stops the page by throwing).
const { cookieValue, redirect, shell } = vi.hoisted(() => ({
  cookieValue: { current: "token-123" as string | undefined },
  redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }),
  shell: { current: { user: { fullName: "Aaron Koh", role: "technical_support_staff" }, counts: {} } as unknown },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/shellServer", () => ({ getShellData: async () => shell.current }));

import { canManageCatalogue, getEquipmentCatalogue } from "@/lib/equipmentCatalogueServer";

function mockServer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  cookieValue.current = "token-123";
  shell.current = { user: { fullName: "Aaron Koh", role: "technical_support_staff" }, counts: {} };
  redirect.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-182/AC5 who is offered the catalogue actions (182-S5)", () => {
  it("182-S5: technical support staff may manage the catalogue; every other role, and a visitor, may not", async () => {
    expect(await canManageCatalogue()).toBe(true);

    for (const role of ["event_coordinator", "event_organiser", "venue_staff", "attendee", "safety_officer", "event_coordinator_lead"]) {
      shell.current = { user: { fullName: "Someone", role }, counts: {} };
      expect(await canManageCatalogue()).toBe(false);
    }

    shell.current = null;
    expect(await canManageCatalogue()).toBe(false);
  });
});

describe("SCRUM-182/AC1 loading the catalogue (182-S1)", () => {
  it("182-S1: asks equipment-service for the items as the signed-in user", async () => {
    const items = [{ id: "e1", name: "Projector Unit", type: "AV", description: null, totalQuantity: 10, location: null, operationalStatus: "available" }];
    const fetchMock = mockServer(200, items);

    expect(await getEquipmentCatalogue()).toEqual({ items });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/equipment-catalogue$/),
      expect.objectContaining({ headers: { cookie: "cs_session=token-123" }, cache: "no-store" }),
    );
  });

  it("182-S5: the service's own reason is passed on, and a reply with no reason gets a plain one", async () => {
    mockServer(403, { error: "You are not allowed to do that." });
    expect(await getEquipmentCatalogue()).toEqual({ error: "You are not allowed to do that." });

    mockServer(500, {});
    expect(await getEquipmentCatalogue()).toEqual({ error: "We couldn't load the equipment catalogue." });
  });

  it("182-S1: an unreachable service says so", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await getEquipmentCatalogue()).toEqual({ error: "We couldn't reach the equipment service. Please try again." });
  });

  it("182-S5: nobody signed in goes to the sign-in page without asking the service, and so does an expired login", async () => {
    cookieValue.current = undefined;
    const fetchMock = mockServer(200, []);
    await expect(getEquipmentCatalogue()).rejects.toThrow("redirect:/login");
    expect(fetchMock).not.toHaveBeenCalled();

    cookieValue.current = "token-123";
    mockServer(401, {});
    await expect(getEquipmentCatalogue()).rejects.toThrow("redirect:/login");
  });
});
