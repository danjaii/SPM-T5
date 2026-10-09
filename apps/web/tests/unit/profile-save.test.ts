import { afterEach, describe, expect, it, vi } from "vitest";
import { saveProfile } from "@/lib/profile";

// ----------------------------------------------------------------------------
// SCRUM-68 saveProfile: the page's call to auth-service. Nothing is really sent: fetch is pretended.
// ----------------------------------------------------------------------------

describe("SCRUM-68 saveProfile", () => {
  afterEach(() => vi.unstubAllGlobals());

  const changes = {
    fullName: "Rachel Lim",
    email: "rachel@example.com",
    phone: "+65 8100 2000",
    communicationPreferences: { email: true, sms: true },
  };
  const updated = { ...changes, loginEmail: "rachel@example.com", role: "event_coordinator", organisation: null };

  // This makes sure the function carries the right details to the service: the four details, sent as a PATCH, with the login cookie.
  it("68-S4: PATCHes the changes to auth-service as JSON, sending the login cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => updated });
    vi.stubGlobal("fetch", fetchMock);

    expect(await saveProfile(changes)).toEqual({ ok: true, data: updated });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4001/profile");
    expect(options).toEqual({
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes),
    });
  });
  // end of the PATCH

  // If auth-service cannot be reached at all, the person gets a plain message instead of a crash.
  it("68-S13: gives a friendly message when auth-service cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    expect(await saveProfile(changes)).toEqual({
      ok: false,
      data: { error: "We couldn't reach the server. Please try again." },
    });
  });
  // end of unreachable
});
// end of SCRUM-68 saveProfile
