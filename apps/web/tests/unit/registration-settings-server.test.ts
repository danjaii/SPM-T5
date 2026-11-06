import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "tok en" }) }) }));

import { getRegistrationSettings } from "@/lib/registrationSettingsServer";

// SCRUM-185/AC4: the server-side loader behind the Registrations tab's form.
afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-185/AC4 185-S4g getRegistrationSettings", () => {
  it("185-S4g: asks event-service as the signed-in user and returns what it answers", async () => {
    const settings = { status: "planning", registrationRequired: true, capacity: 40, opensAt: null, closesAt: null, eventStart: null, confirmedCount: 0, closedByStatus: true };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => settings });
    vi.stubGlobal("fetch", fetchMock);

    expect(await getRegistrationSettings("evt 1")).toEqual(settings);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: { cookie: string } }];
    expect(url).toMatch(/\/events\/evt%201\/registration-settings$/);
    expect(init.headers.cookie).toBe("cs_session=tok%20en");
    expect(init.cache).toBe("no-store");
  });

  it("185-S4e: a refusal (not the assigned coordinator) is null, so the form is left out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "no" }) }));
    expect(await getRegistrationSettings("evt-1")).toBeNull();
  });

  it("185-S4g: an unreachable service is null too", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await getRegistrationSettings("evt-1")).toBeNull();
  });
});
