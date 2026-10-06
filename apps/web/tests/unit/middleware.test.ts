// @vitest-environment node
// (the route guard runs on the server, with Next.js's own Request/Response, not in a browser)

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
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
