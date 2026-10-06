// this test file checks that the registration pages load their data from event-service as the signed-in user

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

import { getEventRegistrations, getMyRegistrations, getRegistrationForm } from "@/lib/eventRegistrationServer";

/** Pretends event-service answered with this status code and JSON body. */
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
// SCRUM-83 — Loading the registration form's data from event-service
// ---------------------------------------------------------------------------
describe("SCRUM-83 — Loading the registration form", () => {
  // AC7, AC8: the form's event details and prefilled fields come from event-service, as the signed-in user
  it("SCRUM-83/AC7 asks event-service for the event's registration form as the signed-in user", async () => {
    const data = { event: { id: "evt-1", name: "Tech Summit" }, prefill: { name: "Alicia", email: "a@example.com", phone: "" } };
    const fetchMock = mockServer(200, data);

    await expect(getRegistrationForm("evt-1")).resolves.toEqual({ data });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4002/events/evt-1/registration-form");
    expect(options.headers.cookie).toBe("cs_session=token-123");
  });
  // end of AC7

  // AC15: "My registrations" comes from event-service, as the signed-in user
  it("SCRUM-83/AC15 asks event-service for the signed-in attendee's registrations", async () => {
    const registrations = [{ id: "reg-1", status: "pending" }];
    const fetchMock = mockServer(200, registrations);

    await expect(getMyRegistrations()).resolves.toEqual({ registrations });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4002/events/my-registrations");
    expect(options.headers.cookie).toBe("cs_session=token-123");
  });

  // AC15: an event's registrations come from event-service as the signed-in organiser or coordinator
  // (RLS decides whose rows they may see)
  it("SCRUM-83/AC15 asks event-service for the event's registrations as the signed-in user", async () => {
    const registrations = [{ id: "reg-1", name: "Alicia Fernandez" }];
    const fetchMock = mockServer(200, registrations);

    await expect(getEventRegistrations("evt-1")).resolves.toEqual({ registrations });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4002/events/evt-1/registrations");
    expect(options.headers.cookie).toBe("cs_session=token-123");
  });
  // end of AC15
});
// end of SCRUM-83
