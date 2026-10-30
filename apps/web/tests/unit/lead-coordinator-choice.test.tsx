import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Pretend loading helpers, so the pages here are only about what they show
const { getLeadAssignment, getLeadReassignment } = vi.hoisted(() => ({ getLeadAssignment: vi.fn(), getLeadReassignment: vi.fn() }));
vi.mock("@/lib/leadServer", () => ({ getLeadAssignment, getLeadReassignment }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import LeadAssignPage from "@/app/lead/events/[id]/assign/page";
import LeadReassignPage from "@/app/lead/events/[id]/reassign/page";
import { LeadAssignForm } from "@/components/LeadAssignForm";
import type { LeadCoordinatorChoice } from "@/lib/leadServer";

const rachel: LeadCoordinatorChoice = {
  id: "c-1",
  full_name: "Rachel Tan",
  workload: 2,
  total_attendance: 150,
  clash: { status: "clash", eventId: "e-1", eventName: "Tech Summit" },
};
const marcus: LeadCoordinatorChoice = { id: "c-2", full_name: "Marcus Lim", workload: 1, total_attendance: 30, clash: { status: "free" } };
const event = {
  id: "evt-1",
  name: "Gala",
  status: "planning",
  organiser_name: "Jason Chua",
  preferred_start_datetime: "2031-06-15T08:00:00Z",
  preferred_end_datetime: "2031-06-15T12:00:00Z",
  expected_attendance: 50,
  submitted_at: "2031-01-02T03:04:00Z",
};
const rowOf = (name: RegExp) => screen.getByRole("radio", { name }).closest("label")!;

afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-168 — choosing a coordinator", () => {
  it("SCRUM-168/AC1 says which event a coordinator clashes with, with an icon and a label", () => {
    render(<LeadAssignForm eventId="evt-1" eventName="Gala" coordinators={[rachel, marcus]} />);

    const row = rowOf(/Rachel Tan/);
    expect(within(row).getByText("Clashes with Tech Summit")).toBeTruthy();
    expect(within(row).getByTestId("status-icon")).toBeTruthy();
  });

  it("SCRUM-168/AC2 says a coordinator with no overlap is free on this date, with an icon and a label", () => {
    render(<LeadAssignForm eventId="evt-1" eventName="Gala" coordinators={[rachel, marcus]} />);

    const row = rowOf(/Marcus Lim/);
    expect(within(row).getByText("Free on this date")).toBeTruthy();
    expect(within(row).getByTestId("status-icon")).toBeTruthy();
  });

  it("SCRUM-168/AC3 shows each coordinator's active events and the people expected across them", () => {
    render(<LeadAssignForm eventId="evt-1" eventName="Gala" coordinators={[rachel, marcus]} />);

    expect(rowOf(/Rachel Tan/).textContent).toContain("2 active events · 150 people expected");
    expect(rowOf(/Marcus Lim/).textContent).toContain("1 active event · 30 people expected");
  });

  it("SCRUM-168/AC4 still lets the Lead choose and confirm a coordinator who clashes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ assigned_coordinator_id: "c-1" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<LeadAssignForm eventId="evt-1" eventName="Gala" coordinators={[rachel, marcus]} />);

    fireEvent.click(screen.getByRole("radio", { name: /Rachel Tan/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm assignment" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Gala is now assigned to Rachel Tan."));
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4002/lead/events/evt-1/assign",
      expect.objectContaining({ body: JSON.stringify({ coordinator_id: "c-1" }) }),
    );
  });

  it("SCRUM-168/AC5 says the event date is not set, and does not call anyone free", () => {
    const undated = [rachel, marcus].map((c) => ({ ...c, clash: { status: "no_date" } as const }));
    render(<LeadAssignForm eventId="evt-1" eventName="Gala" coordinators={undated} />);

    expect(screen.getAllByText("Event date not set")).toHaveLength(2);
    expect(screen.queryByText("Free on this date")).toBeNull();
  });

  it("SCRUM-168/AC4 says so, and still offers the coordinator, when their dates could not be read", () => {
    render(<LeadAssignForm eventId="evt-1" eventName="Gala" coordinators={[{ ...rachel, total_attendance: null, clash: { status: "unavailable" } }]} />);

    expect(within(rowOf(/Rachel Tan/)).getByText("Dates unavailable")).toBeTruthy();
    expect(rowOf(/Rachel Tan/).textContent).not.toContain("people expected");
  });
});

describe("SCRUM-168 — the assign and reassign steps", () => {
  it("SCRUM-168/AC6 SCRUM-168/AC7 the assign step shows the list in the shared page frame, with a back button", async () => {
    getLeadAssignment.mockResolvedValue({ assignment: { event, canAssign: true, coordinators: [rachel, marcus] } });

    const { container } = render(await LeadAssignPage({ params: Promise.resolve({ id: "evt-1" }) }));

    expect(screen.getByRole("heading", { level: 1, name: "Assign a coordinator to Gala" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to unassigned event requests" }).getAttribute("href")).toBe("/lead/queue");
    expect(screen.getByText("Clashes with Tech Summit")).toBeTruthy();
    expect(screen.getByText("Free on this date")).toBeTruthy();
    expect(container.querySelector(".dash__main, .back-link")).toBeNull();
  });

  it("SCRUM-168/AC6 SCRUM-168/AC7 the reassign step shows the same list in the same frame", async () => {
    getLeadReassignment.mockResolvedValue({
      reassignment: { event, current: { id: "c-9", full_name: "Siti Aminah" }, canReassign: true, coordinators: [rachel, marcus] },
    });

    const { container } = render(await LeadReassignPage({ params: Promise.resolve({ id: "evt-1" }) }));

    expect(screen.getByRole("heading", { level: 1, name: "Reassign Gala" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back" }).getAttribute("href")).toBe("/lead/coordinators/c-9");
    expect(screen.getByText("Clashes with Tech Summit")).toBeTruthy();
    expect(screen.getByText("Free on this date")).toBeTruthy();
    expect(screen.getByText("Current coordinator").nextElementSibling!.textContent).toBe("Siti Aminah");
    expect(container.querySelector(".dash__main, .back-link")).toBeNull();
  });

  it("SCRUM-168/AC7 shows a load error in the standard error box", async () => {
    getLeadAssignment.mockResolvedValue({ error: "Event not found." });

    render(await LeadAssignPage({ params: Promise.resolve({ id: "evt-x" }) }));

    expect(screen.getByRole("alert").textContent).toBe("Event not found.");
  });
});
