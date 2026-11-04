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

import { canAddVenue, canEditVenue, getVenueForEdit } from "@/lib/venueCatalogueServer";

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

describe("SCRUM-57/AC3, SCRUM-58/AC3 who is offered the add and edit actions", () => {
  it("58-S3: venue staff may add and edit; every other role, and a visitor, may not", async () => {
    expect(await canAddVenue()).toBe(true);
    expect(await canEditVenue()).toBe(true);

    for (const role of ["event_coordinator", "event_organiser", "technical_support_staff", "attendee", "safety_officer", "event_coordinator_lead"]) {
      shell.current = { user: { fullName: "Someone", role }, counts: {} };
      expect(await canAddVenue()).toBe(false);
      expect(await canEditVenue()).toBe(false);
    }

    shell.current = null;
    expect(await canAddVenue()).toBe(false);
    expect(await canEditVenue()).toBe(false);
  });
});

describe("SCRUM-58/AC1 loading a venue for the edit form (58-S1)", () => {
  it("58-S1: asks venue-service for the venue's edit values as the signed-in user", async () => {
    const venue = { name: "Orchid Hall", maxCapacity: 150, layouts: [], facilityIds: [] };
    const fetchMock = mockServer(200, venue);

    expect(await getVenueForEdit("orchid")).toEqual({ venue });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/venues\/orchid\/edit$/),
      expect.objectContaining({ headers: { cookie: "cs_session=token-123" }, cache: "no-store" }),
    );
  });

  it("58-S1: the id is made safe for the address", async () => {
    const fetchMock = mockServer(200, {});
    await getVenueForEdit("a/b c");
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/venues\/a%2Fb%20c\/edit$/);
  });
});

describe("SCRUM-58/AC3 what is shown when the venue cannot be loaded (58-S3)", () => {
  it("58-S3: the service's own reason is passed on (not venue staff, unknown venue)", async () => {
    mockServer(403, { error: "Only venue staff can edit a venue." });
    expect(await getVenueForEdit("orchid")).toEqual({ error: "Only venue staff can edit a venue." });

    mockServer(404, { error: "Venue not found." });
    expect(await getVenueForEdit("nope")).toEqual({ error: "Venue not found." });
  });

  it("58-S3: a reply with no reason gets a plain one, and an unreachable service says so", async () => {
    mockServer(500, {});
    expect(await getVenueForEdit("orchid")).toEqual({ error: "We couldn't load this venue." });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await getVenueForEdit("orchid")).toEqual({ error: "We couldn't reach the venue service. Please try again." });
  });

  it("58-S3: nobody signed in goes to the sign-in page without asking the service, and so does an expired login", async () => {
    cookieValue.current = undefined;
    const fetchMock = mockServer(200, {});
    await expect(getVenueForEdit("orchid")).rejects.toThrow("redirect:/login");
    expect(fetchMock).not.toHaveBeenCalled();

    cookieValue.current = "token-123";
    mockServer(401, {});
    await expect(getVenueForEdit("orchid")).rejects.toThrow("redirect:/login");
  });
});
