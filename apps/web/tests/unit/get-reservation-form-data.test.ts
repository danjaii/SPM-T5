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

import { getReservationFormData } from "@/lib/equipmentReservationServer";

// ----------------------------------------------------------------------------
// Test setup: pretend equipment-service answers
// ----------------------------------------------------------------------------

const events = [
  { id: "evt-devops", name: "DevOps Summit", status: "approved", date: "2099-10-15", startTime: "09:00", endTime: "17:00", coordinatorName: "Dana Lim" },
];
const equipment = [
  { id: "eq-projector", name: "Projector Unit", type: "AV", totalQuantity: 10, operationalStatus: "available" },
];

/** Pretends equipment-service answers each address with its own status and JSON body. */
function mockServer(replies: Record<string, { status: number; body: unknown }>) {
  const fetchMock = vi.fn(async (url: string) => {
    const path = url.replace("http://localhost:4004", "");
    const reply = replies[path];
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

// ----------------------------------------------------------------------------
// SCRUM-19 loading the reservation page's data from equipment-service
// ----------------------------------------------------------------------------

describe("SCRUM-19 loading the reservation page's data", () => {
  // The page needs two lists: the events equipment can be reserved for, and the equipment to choose from.
  // this is to fetch data on the type of events and equipment so that they can be shown and selected by users
  it("asks equipment-service for the reservable events and the equipment, as the signed-in user", async () => {
    const fetchMock = mockServer({
      "/reservable-events": { status: 200, body: events },
      "/equipment": { status: 200, body: equipment },
    });

    await expect(getReservationFormData()).resolves.toEqual({ events, equipment });

    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls.sort()).toEqual(["http://localhost:4004/equipment", "http://localhost:4004/reservable-events"]);
    for (const [, options] of fetchMock.mock.calls as unknown as Array<[string, { headers: { cookie: string } }]>) {
      expect(options.headers.cookie).toBe("cs_session=token-123");
    }
  });
  // end of loading both lists

  // Someone who is not signed in has no login pass, or one the service no longer accepts (401): either way they are
  // sent to the sign-in page, and with no pass at all the service is not even asked.
  // deny entry to people who are not signed in or whose sign-in has expired, and send them to the sign-in page
  it("sends visitors who aren't signed in to the sign-in page", async () => {
    const fetchMock = mockServer({});
    cookieValue.current = undefined;
    await expect(getReservationFormData()).rejects.toThrow("redirect:/login");
    expect(fetchMock).not.toHaveBeenCalled();

    cookieValue.current = "expired-token";
    mockServer({
      "/reservable-events": { status: 401, body: { error: "Not signed in." } },
      "/equipment": { status: 401, body: { error: "Not signed in." } },
    });
    await expect(getReservationFormData()).rejects.toThrow("redirect:/login");
  });
  // end of not signed in

  // Signed in, but the service says no (for example a 403 because this role may not reserve equipment): the page
  // gets the service's own message to show, instead of a broken form.
  // if the user is not technical suppport staff, the webpage will show only technical support staff can reserve equipment
  it("returns the service's message when it refuses the request", async () => {
    mockServer({
      "/reservable-events": { status: 403, body: { error: "Only technical support staff can reserve equipment." } },
      "/equipment": { status: 403, body: { error: "Only technical support staff can reserve equipment." } },
    });

    await expect(getReservationFormData()).resolves.toEqual({
      error: "Only technical support staff can reserve equipment.",
    });
    expect(redirect).not.toHaveBeenCalled();
  });
  // end of service refuses

  // If equipment-service cannot be reached at all (it is down, or the network drops), the page gets a plain message
  // to show, instead of an error screen.
  //  if we cannot reach the backend, the webpage shows we couldn't reach the server, please try again
  it("returns a friendly message when equipment-service cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));

    await expect(getReservationFormData()).resolves.toEqual({
      error: "We couldn't reach the server. Please try again.",
    });
  });
  // end of service unreachable
});
// end of SCRUM-19 loading the reservation page's data
