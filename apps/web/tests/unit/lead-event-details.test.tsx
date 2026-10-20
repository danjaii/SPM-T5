import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "token-lead" }) }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ refresh: vi.fn() }) }));

import LeadEventPage from "@/app/lead/events/[id]/page";
import { LeadQueueList } from "@/components/LeadQueueList";
import type { LeadQueueItem } from "@/lib/leadServer";

const event = (over: Record<string, unknown> = {}) => ({
  id: "evt-1",
  name: "Tech Summit",
  status: "submitted",
  organiser_name: "Jason Chua",
  point_of_contact_name: null,
  purpose: "Annual conference",
  expected_attendance: 120,
  preferred_start_datetime: "2031-06-15T01:00:00Z",
  preferred_end_datetime: "2031-06-15T09:00:00Z",
  ...over,
});

function mockEvent(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const open = async () => render(await LeadEventPage({ params: Promise.resolve({ id: "evt-1" }) }));

afterEach(() => vi.unstubAllGlobals());

const queueItem: LeadQueueItem = {
  id: "evt-1",
  name: "Tech Summit",
  organiser_name: "Jason Chua",
  preferred_start_datetime: "2031-06-15T01:00:00Z",
  preferred_end_datetime: "2031-06-15T09:00:00Z",
  expected_attendance: 120,
  submitted_at: "2031-01-02T03:04:00Z",
};

describe("SCRUM-126 — the Lead opens an event to see its details", () => {
  it("SCRUM-126/AC1 the event's name in the queue opens its details", () => {
    render(<LeadQueueList requests={[queueItem]} />);

    expect(screen.getByRole("link", { name: "Tech Summit" }).getAttribute("href")).toBe("/lead/events/evt-1");
  });

  it("SCRUM-126/AC1 shows the request's details and status, and offers to assign an unassigned event", async () => {
    const fetchMock = mockEvent(200, event());

    await open();

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:4002/events/evt-1", expect.objectContaining({ cache: "no-store" }));
    expect(screen.getByRole("heading", { name: "Tech Summit" })).toBeTruthy();
    expect(screen.getByText("No coordinator assigned yet")).toBeTruthy();
    expect(screen.getByText("Annual conference")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Assign coordinator" }).getAttribute("href")).toBe("/lead/events/evt-1/assign");
  });

  it("SCRUM-126/AC1 offers to reassign an event that has a coordinator", async () => {
    mockEvent(200, event({ status: "under_review", point_of_contact_name: "Rachel Tan" }));

    await open();

    expect(screen.getByText("Coordinator: Rachel Tan")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Reassign coordinator" }).getAttribute("href")).toBe("/lead/events/evt-1/reassign");
  });

  it("SCRUM-126/AC1 offers no assign action for a closed event", async () => {
    mockEvent(200, event({ status: "completed", point_of_contact_name: "Rachel Tan" }));

    await open();

    expect(screen.queryByRole("link", { name: /coordinator$/ })).toBeNull();
  });

  it("SCRUM-126/AC11 shows event-service's message when the event can't be opened", async () => {
    mockEvent(404, { error: "Event not found." });

    await open();

    expect(screen.getByRole("alert").textContent).toBe("Event not found.");
  });
});
