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

// ---------------------------------------------------------------------------
// SCRUM-75 — Lead pages (/lead/*) are behind the route guard, for Event Coordinator Leads only
// ---------------------------------------------------------------------------
describe("SCRUM-75 — Lead page route guard", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** auth-service's /auth/me answers: this cookie belongs to a user with this role. */
  const signedInAs = (role: string) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ role }) }));
    return { headers: { cookie: `cs_session=token-${role}` } };
  };

  // AC6: a Lead can open a Lead page
  it.each(["/lead/queue", "/lead/coordinators", "/dashboard/event_coordinator_lead"])(
    "SCRUM-75/AC6 lets a signed-in Lead open %s",
    async (path) => {
      const res = await middleware(new NextRequest(`http://localhost:3000${path}`, signedInAs("event_coordinator_lead")));

      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("x-middleware-next")).toBe("1");
    },
  );
  // end of AC6

  // AC7: anyone else typing a Lead page's URL is refused (SCRUM-122/AC3: with the access-denied page, no longer a bounce
  // to their own dashboard), and a guest is sent to sign in
  it.each(["event_coordinator", "venue_staff", "event_organiser", "attendee", "safety_officer"])(
    "SCRUM-75/AC7 sends a %s who opens a Lead page by URL to the access-denied page",
    async (role) => {
      const res = await middleware(new NextRequest("http://localhost:3000/lead/queue", signedInAs(role)));

      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("http://localhost:3000/access-denied");
    },
  );

  it("SCRUM-75/AC7 sends a guest who opens a Lead page to the sign-in page", async () => {
    const res = await middleware(new NextRequest("http://localhost:3000/lead/coordinators"));

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it("SCRUM-75/AC7 the route guard covers every Lead page", async () => {
    const { config } = await import("@/middleware");
    expect(config.matcher).toContain("/lead/:path*");
  });
  // end of AC7
});
// end of SCRUM-75

// ---------------------------------------------------------------------------
// SCRUM-122 — a page outside the caller's role shows the access-denied page
// ---------------------------------------------------------------------------
describe("SCRUM-122 — Access-denied route guard", () => {
  afterEach(() => vi.unstubAllGlobals());

  const signedInAs = (role: string) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ role }) }));
    return { headers: { cookie: `cs_session=token-${role}` } };
  };

  it.each(["/dashboard/venue_staff", "/booking-queue", "/safety-checks", "/equipment-requests"])(
    "SCRUM-122/AC3 sends an attendee who opens %s to the access-denied page",
    async (path) => {
      const res = await middleware(new NextRequest(`http://localhost:3000${path}`, signedInAs("attendee")));

      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("http://localhost:3000/access-denied");
    },
  );

  it("SCRUM-122/AC3 lets venue staff open the booking queue", async () => {
    const res = await middleware(new NextRequest("http://localhost:3000/booking-queue", signedInAs("venue_staff")));

    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});
// end of SCRUM-122

// ---------------------------------------------------------------------------
// SCRUM-15 — Each role only reaches the pages authorised for it
// ---------------------------------------------------------------------------
describe("SCRUM-15 — Role-based route guard", () => {
  afterEach(() => vi.unstubAllGlobals());

  const signedInAs = (role: string) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ role }) }));
    return { headers: { cookie: `cs_session=token-${role}` } };
  };
  const open = (path: string, role: string) => middleware(new NextRequest(`http://localhost:3000${path}`, signedInAs(role)));
  const isDenied = (res: Response) => res.headers.get("location") === "http://localhost:3000/access-denied";

  const STORY_ROLES = [
    ["AC1", "event_organiser"],
    ["AC2", "event_coordinator"],
    ["AC3", "venue_staff"],
    ["AC4", "technical_support_staff"],
    ["AC5", "attendee"],
  ] as const;

  // AC1-AC5: each role opens its own dashboard, and every other role's dashboard shows the access-denied page
  it.each(STORY_ROLES)("SCRUM-15/%s %s opens its own dashboard and no one else's", async (_ac, role) => {
    expect(isDenied(await open(`/dashboard/${role}`, role))).toBe(false);
    for (const [, other] of STORY_ROLES.filter(([, r]) => r !== role)) {
      expect(isDenied(await open(`/dashboard/${other}`, role)), `${role} opening /dashboard/${other}`).toBe(true);
    }
  });

  // AC3: the venue booking queue is for venue staff; AC4: the equipment pages are for Technical Support Staff
  it.each([
    ["AC3", "/booking-queue", "venue_staff"],
    ["AC4", "/equipment-requests", "technical_support_staff"],
    ["AC4", "/equipment-availability", "technical_support_staff"],
    ["AC4", "/equipment-reservation", "technical_support_staff"],
  ])("SCRUM-15/%s %s opens only for %s", async (_ac, path, owner) => {
    expect(isDenied(await open(path, owner))).toBe(false);
    for (const [, other] of STORY_ROLES.filter(([, r]) => r !== owner)) {
      expect(isDenied(await open(path, other)), `${other} opening ${path}`).toBe(true);
    }
  });
});
// end of SCRUM-15
