// this test case is used to check if we can get the data from the backend to the frontend

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

import { getVenue, getVenues } from "@/lib/getVenues";

/** Pretends venue-service answered with this status code and JSON body. */
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

// ---------------------------------------------------------------------------
// SCRUM-29 — Loading the venue catalogue from venue-service
// ---------------------------------------------------------------------------
describe("SCRUM-29 — Loading venues", () => {
  // AC1 (Scenario 1): the catalogue page gets the venue list from venue-service, as the signed-in user
  it("asks venue-service for the venue list as the signed-in user", async () => {
    const venues = [{ id: "v1", name: "Orchid Hall", address: "Level 3, East Wing", max_capacity: 150 }];
    const fetchMock = mockServer(200, venues);

    await expect(getVenues()).resolves.toEqual({ venues });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4003/venues");
    expect(options.headers.cookie).toBe("cs_session=token-123");
  });
  // end of AC1

  // Not signed in (no login cookie, or venue-service says the login has expired) → the sign-in page
  // if user is not signed in, redirect them to login page 
  it("sends visitors who aren't signed in to the sign-in page", async () => {
    cookieValue.current = undefined;
    await expect(getVenues()).rejects.toThrow("redirect:/login");

    cookieValue.current = "expired-token";
    mockServer(401, { error: "Not signed in." });
    await expect(getVenues()).rejects.toThrow("redirect:/login");
  });
  // end of not signed in

  // AC4 (Scenario 4): a user whose role isn't allowed gets venue-service's "not allowed" message to show
  it("passes on venue-service's message when the user isn't allowed to see the catalogue", async () => {
    mockServer(403, { error: "You are not allowed to view the venue catalogue." });

    await expect(getVenues()).resolves.toEqual({ error: "You are not allowed to view the venue catalogue." });
  });
  // end of AC4

  // AC2 (Scenario 2): the detail page gets one venue's full details from venue-service, as the signed-in user
  it("asks venue-service for one venue's details as the signed-in user", async () => {
    // checks that if the user clicks on orchid venue, does it show the additional details of orchid venue
    const venue = { id: "orchid", name: "Orchid Hall", layouts: [], facilities: [] };
    const fetchMock = mockServer(200, venue);

    await expect(getVenue("orchid")).resolves.toEqual({ venue });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4003/venues/orchid");
    // checks if we are aiming at the right website. but for this test case, we won't actually go the to real stated website. the going part is covered in later stages
    expect(options.headers.cookie).toBe("cs_session=token-123");
  });
  // end of AC2

  // Not signed in, on the detail page too → the sign-in page
  // This is for the webpage when user clicks to find more details about a particular venue. When they are not logged in, they should be redirected instead, and not see this webpage
  it("sends visitors who aren't signed in to the sign-in page from a venue's detail page", async () => {
    cookieValue.current = undefined;
    await expect(getVenue("orchid")).rejects.toThrow("redirect:/login");

    cookieValue.current = "expired-token";
    mockServer(401, { error: "Not signed in." });
    await expect(getVenue("orchid")).rejects.toThrow("redirect:/login");
  });
  // end of not signed in (detail)

  // AC4 (Scenario 4) on the detail page, plus a venue that doesn't exist: pass venue-service's message on to show
  // when the backend has made the call that the person should not be seeing the details webpage, make sure that our webpage can properly show that the person is not allowed to view the venue catalogue
  it("passes on venue-service's message when a venue's details can't be shown", async () => {
    mockServer(403, { error: "You are not allowed to view the venue catalogue." });
    await expect(getVenue("orchid")).resolves.toEqual({ error: "You are not allowed to view the venue catalogue." });

    mockServer(404, { error: "Venue not found." });
    await expect(getVenue("no-such-venue")).resolves.toEqual({ error: "Venue not found." });
  });
  // end of AC4 (detail)
});
// end of SCRUM-29
