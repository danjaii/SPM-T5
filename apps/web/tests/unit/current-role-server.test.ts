// SCRUM-130/AC3: the role the calendar page uses to decide on Mark unavailable. Anything doubtful means no button.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ token: "tok" as string | undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (jar.token ? { value: jar.token } : undefined) }) }));

import { getCurrentRole } from "@/lib/currentRoleServer";

beforeEach(() => { jar.token = "tok"; });
afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-130/AC3 getCurrentRole", () => {
  it("asks auth-service who the caller is, with their cookie, and returns the role", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ role: "venue_staff" }) }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getCurrentRole()).toBe("venue_staff");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/auth\/me$/);
    expect((init.headers as Record<string, string>).cookie).toContain("tok");
  });

  it("returns nothing without a session cookie, and does not call auth-service", async () => {
    jar.token = undefined;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await getCurrentRole()).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns nothing when auth-service refuses or cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    expect(await getCurrentRole()).toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect(await getCurrentRole()).toBeUndefined();
  });
});
