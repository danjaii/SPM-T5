// SCRUM-75 — the Event Coordinator Lead signs in through the usual sign-in page and lands on their own home page

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ replace: vi.fn() }), redirect }));

import LeadDashboard from "@/app/dashboard/event_coordinator_lead/page";
import { LoginForm } from "@/components/LoginForm";
import { NAV_ITEMS } from "@/lib/nav";


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

  // AC4: the Lead home page links to the unassigned event queue and the coordinator overview.
  // SCRUM-188/AC1, AC2: the home page is the queue itself; the old dashboard address forwards there.
  it("SCRUM-75/AC4 SCRUM-188/AC2 the Lead's home is the unassigned queue, and the sidebar links to the coordinator overview", () => {
    LeadDashboard();

    expect(redirect).toHaveBeenCalledWith("/lead/queue");
    expect(NAV_ITEMS.event_coordinator_lead.map((i) => i.href)).toEqual(["/lead/queue", "/lead/events", "/lead/coordinators"]);
  });
  // end of AC4
});
// end of SCRUM-75
