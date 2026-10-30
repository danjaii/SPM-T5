// SCRUM-75 — the Event Coordinator Lead signs in through the usual sign-in page and lands on their own home page

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Pretend the loading helper (tested in its own file), so these tests are only about the pages
const { getLeadQueue, getLeadCoordinators } = vi.hoisted(() => ({ getLeadQueue: vi.fn(), getLeadCoordinators: vi.fn() }));
vi.mock("@/lib/leadServer", () => ({ getLeadQueue, getLeadCoordinators }));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ replace: vi.fn() }) }));

import LeadDashboard from "@/app/dashboard/event_coordinator_lead/page";
import { LoginForm } from "@/components/LoginForm";
import { ShellContext } from "@/components/shell/ShellContext";


// ---------------------------------------------------------------------------
// SCRUM-75 — Set up the Event Coordinator Lead role
// ---------------------------------------------------------------------------
describe("SCRUM-75 — Event Coordinator Lead sign-in and home page", () => {
  // AC3: the Lead signs in on the same page as everyone else (SCRUM-13), choosing the Lead role
  it("SCRUM-75/AC3 offers Event Coordinator Lead as a role on the sign-in page", async () => {
    render(<LoginForm />);

    fireEvent.click(screen.getByRole("combobox", { name: /Continue as/ }));
    expect(await screen.findByRole("option", { name: /Event Coordinator Lead/ })).toBeTruthy();
  });
  // end of AC3

  // AC4: the Lead home page links to the unassigned event queue and the coordinator overview
  it("SCRUM-75/AC4 the Lead home page links to the unassigned event queue and the coordinator overview", async () => {
    getLeadQueue.mockResolvedValue({ requests: [{ id: "a", name: "Gala" }] });
    getLeadCoordinators.mockResolvedValue({ coordinators: [{ id: "c", full_name: "Ann", workload: 2 }] });

    render(
      <ShellContext.Provider value={{ user: { fullName: "Helen Ong", role: "event_coordinator_lead" }, counts: { leadQueue: 1 } }}>
        {await LeadDashboard()}
      </ShellContext.Provider>,
    );

    // SCRUM-162: the home page is now an overview, so each link sits on the part that summarises its list
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /unassigned event request/ }).getAttribute("href")).toBe("/lead/queue");
    expect(screen.getByRole("link", { name: "View all coordinators" }).getAttribute("href")).toBe("/lead/coordinators");
  });
  // end of AC4
});
// end of SCRUM-75
