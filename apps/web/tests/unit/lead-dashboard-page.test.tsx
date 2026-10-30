import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }) }));

// Pretend loading helpers, so this test is only about the page itself
const { getLeadQueue, getLeadCoordinators } = vi.hoisted(() => ({ getLeadQueue: vi.fn(), getLeadCoordinators: vi.fn() }));
vi.mock("@/lib/leadServer", () => ({ getLeadQueue, getLeadCoordinators }));

import EventCoordinatorLeadDashboard from "@/app/dashboard/event_coordinator_lead/page";
import { ShellContext } from "@/components/shell/ShellContext";
import type { QueueCounts } from "@/lib/nav";

const coordinator = (full_name: string, workload: number) => ({ id: full_name, full_name, workload });
const request = (id: string) => ({ id, name: id });

async function renderPage(counts: QueueCounts = { leadQueue: 0 }) {
  render(
    <ShellContext.Provider value={{ user: { fullName: "Lee", role: "event_coordinator_lead" }, counts }}>
      {await EventCoordinatorLeadDashboard()}
    </ShellContext.Provider>,
  );
}

const stat = (label: string) => screen.getByText(label).closest("li")!;

describe("SCRUM-162 Event Coordinator Lead dashboard", () => {
  it("SCRUM-162/AC1 shows three counts, each with an icon and a label", async () => {
    getLeadQueue.mockResolvedValue({ requests: [request("a"), request("b")] });
    getLeadCoordinators.mockResolvedValue({ coordinators: [coordinator("Ann", 3), coordinator("Bo", 1)] });

    await renderPage({ leadQueue: 2 });

    expect(within(stat("Unassigned requests")).getByText("2")).toBeTruthy();
    expect(within(stat("Active events")).getByText("4")).toBeTruthy();
    expect(within(stat("Coordinators")).getByText("2")).toBeTruthy();
    for (const label of ["Unassigned requests", "Active events", "Coordinators"]) {
      expect(stat(label).querySelector("svg")).toBeTruthy();
    }
  });

  it("SCRUM-162/AC2 lists one Needs your action entry with the count, linked to the queue, and not the requests", async () => {
    getLeadQueue.mockResolvedValue({ requests: [request("Tech Summit"), request("Gala")] });
    getLeadCoordinators.mockResolvedValue({ coordinators: [] });

    await renderPage({ leadQueue: 2 });

    expect(screen.getByRole("link", { name: "2 unassigned event requests waiting for a coordinator" }).getAttribute("href")).toBe("/lead/queue");
    expect(screen.getByText("Action needed")).toBeTruthy();
    expect(screen.queryByText("Tech Summit")).toBeNull();
  });

  it("SCRUM-162/AC3 shows the busiest and least busy coordinator and a link to all, not the whole list", async () => {
    getLeadQueue.mockResolvedValue({ requests: [] });
    getLeadCoordinators.mockResolvedValue({
      coordinators: [coordinator("Ann", 3), coordinator("Bo", 1), coordinator("Cy", 2)],
    });

    await renderPage();

    const row = (label: string) => screen.getByText(label).closest("li")!.textContent;
    expect(row("Busiest")).toContain("Ann");
    expect(row("Busiest")).toContain("3 active");
    expect(row("Least busy")).toContain("Bo");
    expect(row("Least busy")).toContain("1 active");
    expect(screen.queryByText("Cy")).toBeNull();
    expect(screen.getByRole("link", { name: "View all coordinators" }).getAttribute("href")).toBe("/lead/coordinators");
  });

  it("SCRUM-162/AC4 says no requests are unassigned, without a link", async () => {
    getLeadQueue.mockResolvedValue({ requests: [] });
    getLeadCoordinators.mockResolvedValue({ coordinators: [coordinator("Ann", 1)] });

    await renderPage({ leadQueue: 0 });

    expect(screen.getByText("No unassigned event requests.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /unassigned event request/ })).toBeNull();
  });

  it("SCRUM-162/AC5 says no coordinators are assigned and counts 0", async () => {
    getLeadQueue.mockResolvedValue({ requests: [] });
    getLeadCoordinators.mockResolvedValue({ coordinators: [] });

    await renderPage();

    expect(screen.getByText("No coordinators are assigned to you.")).toBeTruthy();
    expect(within(stat("Coordinators")).getByText("0")).toBeTruthy();
  });

  it("SCRUM-162/AC6 shows Unavailable, not 0, for counts that could not be loaded", async () => {
    getLeadQueue.mockResolvedValue({ error: "down" });
    getLeadCoordinators.mockResolvedValue({ error: "down" });

    await renderPage({});

    for (const label of ["Unassigned requests", "Active events", "Coordinators"]) {
      expect(within(stat(label)).getByText("Unavailable")).toBeTruthy();
      expect(within(stat(label)).queryByText("0")).toBeNull();
    }
  });
});
