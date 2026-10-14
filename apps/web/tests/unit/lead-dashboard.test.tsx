// SCRUM-75 — the Event Coordinator Lead signs in through the usual sign-in page and lands on their own home page

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Pretend the loading helper (tested in its own file), so these tests are only about the pages
const { getDashboard } = vi.hoisted(() => ({ getDashboard: vi.fn() }));
vi.mock("@/lib/dashboard", () => ({ getDashboard }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import LeadDashboard from "@/app/dashboard/event_coordinator_lead/page";
import { LoginForm } from "@/components/LoginForm";

/** What auth-service sends for a Lead's dashboard. */
const dashboard = {
  user: { fullName: "Helen Ong", email: "helen.ong@connectsphere.example.com", role: "event_coordinator_lead" },
  sections: [],
};

// ---------------------------------------------------------------------------
// SCRUM-75 — Set up the Event Coordinator Lead role
// ---------------------------------------------------------------------------
describe("SCRUM-75 — Event Coordinator Lead sign-in and home page", () => {
  // AC3: the Lead signs in on the same page as everyone else (SCRUM-13), choosing the Lead role
  it("SCRUM-75/AC3 offers Event Coordinator Lead as a role on the sign-in page", () => {
    render(<LoginForm />);

    expect(screen.getByRole("radio", { name: /Event Coordinator Lead/ })).toBeTruthy();
  });
  // end of AC3

  // AC4: the Lead home page links to the unassigned event queue and the coordinator overview
  it("SCRUM-75/AC4 the Lead home page links to the unassigned event queue and the coordinator overview", async () => {
    getDashboard.mockResolvedValue(dashboard);

    render(await LeadDashboard());

    expect(getDashboard).toHaveBeenCalledWith("event_coordinator_lead");
    expect(screen.getByRole("heading", { name: "Event Coordinator Lead dashboard" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Unassigned event requests" }).getAttribute("href")).toBe("/lead/queue");
    expect(screen.getByRole("link", { name: "Coordinator overview" }).getAttribute("href")).toBe("/lead/coordinators");
  });
  // end of AC4
});
// end of SCRUM-75
