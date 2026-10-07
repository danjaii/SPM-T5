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

import { getProfile } from "@/lib/profileServer";

// ----------------------------------------------------------------------------
// Test setup: pretend auth-service answers
// ----------------------------------------------------------------------------

const profile = {
  fullName: "Rachel Tan",
  email: "rachel@example.com",
  loginEmail: "rachel@example.com",
  phone: "+65 8100 2000",
  communicationPreferences: { email: true, sms: false },
  role: "event_coordinator",
  organisation: null,
  department: "Event Coordination",
  responsibilities: ["Search for venues and submit venue booking requests"],
};

/** Pretends auth-service answers with a status and a JSON body. */
function mockServer(reply: { status: number; body: unknown }) {
  const fetchMock = vi.fn(async () => ({ ok: reply.status < 400, status: reply.status, json: async () => reply.body }));
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
// SCRUM-68 loading the profile page's data from auth-service
// ----------------------------------------------------------------------------

describe("SCRUM-68 loading the profile", () => {
  // The profile page needs the signed-in person's own profile: it is asked for as that person, using their login cookie.
  it("68-S1: asks auth-service for the profile, as the signed-in user", async () => {
    const fetchMock = mockServer({ status: 200, body: profile });

    await expect(getProfile()).resolves.toEqual({ profile });

    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, { headers: { cookie: string } }];
    expect(url).toBe("http://localhost:4001/profile");
    expect(options.headers.cookie).toBe("cs_session=token-123");
  });
  // Someone who is not signed in has no login pass, or one the service no longer accepts (401): either way they are sent to
  // the sign-in page, and with no pass at all the service is not even asked.
  // someone who is not signed in , we show them that they need to sign in again 
  it("68-S18: sends visitors who aren't signed in to the sign-in page", async () => {
    const fetchMock = mockServer({ status: 200, body: profile });
    cookieValue.current = undefined;
    await expect(getProfile()).rejects.toThrow("redirect:/login");
    expect(fetchMock).not.toHaveBeenCalled();

    cookieValue.current = "expired-token";
    mockServer({ status: 401, body: { error: "Session expired. Please sign in again." } });
    await expect(getProfile()).rejects.toThrow("redirect:/login");
  });
  // Signed in, but the service cannot give the profile (for example the database is down): the page gets the service's own
  // message to show, instead of a broken page.
  it("68-S1: returns the service's message when it cannot give the profile", async () => {
    mockServer({ status: 500, body: { error: "Something went wrong." } });

    await expect(getProfile()).resolves.toEqual({ error: "Something went wrong." });
    expect(redirect).not.toHaveBeenCalled();
  });

  // If auth-service cannot be reached at all (it is down, or the network drops), the page gets a plain message to show.
  // for person who is already signed in, but the server didnt respond or server answered with an error 
  it("68-S1: returns a friendly message when auth-service cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));

    await expect(getProfile()).resolves.toEqual({ error: "We couldn't reach the server. Please try again." });
  });
  // end of loading the profile
});
// end of SCRUM-68 loading the profile
