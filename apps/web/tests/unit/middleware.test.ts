// @vitest-environment node
// (the route guard runs on the server, with Next.js's own Request/Response, not in a browser)

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { middleware } from "@/middleware";

// ---------------------------------------------------------------------------
// SCRUM-71 — The List of events lives on the attendee dashboard, behind the dashboard route guard
// ---------------------------------------------------------------------------
describe("SCRUM-71 — Dashboard route guard", () => {
  // AC6: a guest who opens the list is sent to the sign-in page (no login cookie, so auth-service isn't asked)
  it("SCRUM-71/AC6 sends a guest who opens the attendee dashboard to the sign-in page", async () => {
    const res = await middleware(new NextRequest("http://localhost:3000/dashboard/attendee"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login");
  });
  // end of AC6
});
// end of SCRUM-71

// ---------------------------------------------------------------------------
// SCRUM-83 — The registration form is behind the route guard too, and remembers where the guest was going
// ---------------------------------------------------------------------------
describe("SCRUM-83 — Registration form route guard", () => {
  afterEach(() => vi.unstubAllGlobals());

  // AC2: a guest who selects Register goes to the sign-in page, which is told where to return them afterwards
  it("SCRUM-83/AC2 sends a guest who opens a registration form to sign in, remembering the form", async () => {
    const res = await middleware(new NextRequest("http://localhost:3000/events/evt-1/register"));

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/events/evt-1/register");
  });

  // AC2: once signed in, the attendee lands on the registration form itself (not bounced to their dashboard)
  it("SCRUM-83/AC2 lets a signed-in attendee open the registration form", async () => {
    // auth-service's /auth/me answers: this cookie belongs to an attendee
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ role: "attendee" }) }));
    const request = new NextRequest("http://localhost:3000/events/evt-1/register", {
      headers: { cookie: "cs_session=token-attendee" },
    });

    const res = await middleware(request);

    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1"); // Next.js's "carry on to the page"
  });
  // end of AC2
});
// end of SCRUM-83
