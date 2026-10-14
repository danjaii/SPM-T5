import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookieValue, redirect } = vi.hoisted(() => ({
  cookieValue: { current: "token-lead" as string | undefined },
  redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));
vi.mock("next/navigation", () => ({ redirect }));

import LeadQueuePage from "@/app/lead/queue/page";
import { LeadQueueList } from "@/components/LeadQueueList";
import { getLeadQueue, type LeadQueueItem } from "@/lib/leadServer";

const item = (over: Partial<LeadQueueItem> = {}): LeadQueueItem => ({
  id: "evt-1",
  name: "Tech Summit",
  organiser_name: "Jason Chua",
  preferred_start_datetime: "2031-06-15T01:00:00Z", // 9:00 AM in Singapore
  preferred_end_datetime: "2031-06-15T09:00:00Z",
  expected_attendance: 120,
  submitted_at: "2031-01-02T03:04:00Z",
  ...over,
});

function mockServer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  cookieValue.current = "token-lead";
  redirect.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------------------
// SCRUM-77 — View unassigned event requests (/lead/queue)
// ---------------------------------------------------------------------------
describe("SCRUM-77 — Unassigned event queue page", () => {
  // AC1 + AC2: each waiting request is shown with its name, organiser, preferred date and time, attendance, submission date
  it("SCRUM-77/AC1 SCRUM-77/AC2 shows each request's name, organiser, preferred date and time, attendance and submission date", () => {
    render(<LeadQueueList requests={[item()]} />);

    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Event", "Event Organiser", "Preferred date and time", "Expected attendance", "Submitted"]);
    const cells = [...screen.getAllByRole("row")[1].querySelectorAll("td")].map((c) => c.textContent);
    expect(cells[0]).toBe("Tech Summit");
    expect(cells[1]).toBe("Jason Chua");
    expect(cells[2]).toBe("Sun, 15 Jun 2031, 9:00 AM – 5:00 PM");
    expect(cells[3]).toBe("120");
    expect(cells[4]).toBe("2031-01-02 11:04");
  });

  it("SCRUM-77/AC2 says so when a request has no preferred date or attendance yet", () => {
    render(<LeadQueueList requests={[item({ preferred_start_datetime: null, preferred_end_datetime: null, expected_attendance: null })]} />);

    const cells = [...screen.getAllByRole("row")[1].querySelectorAll("td")].map((c) => c.textContent);
    expect(cells[2]).toBe("Not specified");
    expect(cells[3]).toBe("Not specified");
  });
  // end of AC1 + AC2

  // AC3: the page keeps the oldest-first order event-service returns
  it("SCRUM-77/AC3 lists the requests in the order received, oldest submission first", () => {
    render(<LeadQueueList requests={[item({ id: "a", name: "Oldest" }), item({ id: "b", name: "Middle" }), item({ id: "c", name: "Newest" })]} />);

    const names = screen.getAllByRole("row").slice(1).map((r) => r.querySelector("td")!.textContent);
    expect(names).toEqual(["Oldest", "Middle", "Newest"]);
  });
  // end of AC3

  // AC6: an empty queue says clearly that nothing is waiting
  it("SCRUM-77/AC6 says no requests are awaiting coordinator assignment when the queue is empty", () => {
    render(<LeadQueueList requests={[]} />);

    expect(screen.getByText("No event requests are awaiting coordinator assignment.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
  // end of AC6

  it("SCRUM-77 loads the queue from event-service as the signed-in user, and shows it on the page", async () => {
    const fetchMock = mockServer(200, [item()]);

    render(await LeadQueuePage());

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4002/lead/queue",
      expect.objectContaining({ headers: { cookie: "cs_session=token-lead" }, cache: "no-store" }),
    );
    expect(screen.getByRole("heading", { name: "Unassigned event requests" })).toBeTruthy();
    expect(screen.getByText("Tech Summit")).toBeTruthy();
  });

  // AC7: if event-service refuses (not a Lead), the page shows its refusal and no requests
  it("SCRUM-77/AC7 shows the refusal, and no requests, when event-service denies access", async () => {
    mockServer(403, { error: "Only an Event Coordinator Lead can do this." });

    expect(await getLeadQueue()).toEqual({ error: "Only an Event Coordinator Lead can do this." });
    render(await LeadQueuePage());
    expect(screen.getByRole("alert").textContent).toBe("Only an Event Coordinator Lead can do this.");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("SCRUM-77/AC7 sends someone who isn't signed in to the sign-in page", async () => {
    cookieValue.current = undefined;
    await expect(getLeadQueue()).rejects.toThrow("redirect:/login");
  });
  // end of AC7
});
// end of SCRUM-77
