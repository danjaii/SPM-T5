import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventStatusPanel } from "@/components/EventStatusPanel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const event = { id: "evt-1", name: "Tech Summit", status: "under_review", canChangeStatus: false, canReview: false };

/** Pretends event-service answered the browser's request with this status code and JSON body. */
function mockServer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Event status page", () => {
  // SCRUM-6 AC1 / SCRUM-7 AC1: the viewer sees the event's current status
  it("shows the event's name and current status", () => {
    render(<EventStatusPanel event={event} />);

    expect(screen.getByRole("heading", { name: "Tech Summit" })).toBeTruthy();
    expect(screen.getByText("Under Review")).toBeTruthy();
  });

  // SCRUM-8 AC4 + AC6: only the assigned coordinator gets the controls to change the status
  it("hides the status controls from anyone who can't change the status", () => {
    render(<EventStatusPanel event={event} />);

    expect(screen.queryByRole("combobox", { name: "New status" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  // SCRUM-8 AC1 + AC2: the assigned coordinator changes the status and gets a confirmation
  it("lets the assigned coordinator change the status and confirms it", async () => {
    const fetchMock = mockServer(200, { id: "evt-1", name: "Tech Summit", status: "returned" });
    render(<EventStatusPanel event={{ ...event, canChangeStatus: true }} />);

    fireEvent.change(screen.getByRole("combobox", { name: "New status" }), { target: { value: "returned" } });
    fireEvent.change(screen.getByLabelText("Reason (optional)"), { target: { value: "Please add attendance." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Status updated to Returned.")).toBeTruthy();
    expect(screen.getByText("Returned", { selector: "header [data-tone]" })).toBeTruthy(); // the shown status updates too
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4002/events/evt-1/status");
    expect(options).toMatchObject({ method: "PATCH", credentials: "include" });
    expect(JSON.parse(options.body)).toEqual({ status: "returned", reason: "Please add attendance." });
  });

  // SCRUM-8 AC3/AC4/AC6: when the server refuses, the coordinator sees why
  it("shows the server's message when the change is refused", async () => {
    mockServer(403, { error: "Only the coordinator assigned to this event can change its status." });
    render(<EventStatusPanel event={{ ...event, canChangeStatus: true }} />);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Only the coordinator assigned to this event can change its status.")).toBeTruthy();
    expect(screen.getByText("Under Review", { selector: "header [data-tone]" })).toBeTruthy(); // the shown status stays the same
  });
});

describe("SCRUM-45 — Start reviewing an event request", () => {
  const submitted = { ...event, status: "submitted" };

  it("AC1, AC2: the assigned coordinator starts the review and sees Under review", async () => {
    const fetchMock = mockServer(200, { id: "evt-1", name: "Tech Summit", status: "under_review" });
    render(<EventStatusPanel event={{ ...submitted, canChangeStatus: true }} />);

    fireEvent.click(screen.getByRole("button", { name: "Start review" }));

    expect(await screen.findByText("Status updated to Under review.")).toBeTruthy();
    expect(screen.getByText("Under Review", { selector: "header [data-tone]" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start review" })).toBeNull(); // AC3: no longer submitted
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4002/events/evt-1/status");
    expect(JSON.parse(options.body)).toEqual({ status: "under_review" }); // AC4: history is recorded server-side
  });

  it("AC3: is not offered once the request is past submitted", () => {
    render(<EventStatusPanel event={{ ...event, canChangeStatus: true }} />);
    expect(screen.queryByRole("button", { name: "Start review" })).toBeNull();
  });

  it("AC5: is not offered to anyone but the assigned coordinator", () => {
    render(<EventStatusPanel event={{ ...submitted, canReview: true }} />);
    expect(screen.queryByRole("button", { name: "Start review" })).toBeNull();
  });
});

describe("SCRUM-24 — Decision on the event page", () => {
  it("AC4: shows the new status once the request is approved", async () => {
    mockServer(200, { id: "evt-1", name: "Tech Summit", status: "approved" });
    render(<EventStatusPanel event={{ ...event, canReview: true }} />);

    fireEvent.click(screen.getByRole("button", { name: "Approve request" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Approve request" }));

    expect(await screen.findByText("Status updated to Approved.")).toBeTruthy();
    expect(screen.getByText("Approved", { selector: "header [data-tone]" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve request" })).toBeNull(); // no second decision (dialog closed, actions gone)
  });

  it("AC5: shows no decision to someone who may not review", () => {
    render(<EventStatusPanel event={event} />);
    expect(screen.queryByRole("group", { name: "Review this request" })).toBeNull();
  });
});

// SCRUM-174 — Cancel an Event and Release Its Arrangements (docs/specs/cancel-event.md)
describe("SCRUM-174 — Cancel an event on the event page", () => {
  const assigned = { ...event, status: "planning", canChangeStatus: true };
  const choose = (status: string) => fireEvent.change(screen.getByRole("combobox", { name: "New status" }), { target: { value: status } });

  it("174-S13 SCRUM-174/AC1: asks for a reason once Cancelled is chosen, and says who will see it", () => {
    render(<EventStatusPanel event={assigned} />);

    choose("cancelled");

    const reason = screen.getByLabelText("Reason (required)") as HTMLTextAreaElement;
    expect(reason.required).toBe(true);
    expect(screen.getByText("The organiser and registered attendees will be told this reason.")).toBeTruthy();
  });

  it("174-S13 SCRUM-174/AC1: keeps the reason optional for other statuses", () => {
    render(<EventStatusPanel event={assigned} />);

    choose("approved");

    expect(screen.getByLabelText("Reason (optional)")).toBeTruthy();
  });

  it("174-S13 SCRUM-174/AC1: sends nothing and says so when Cancelled is saved without a reason", () => {
    const fetchMock = mockServer(200, {});
    render(<EventStatusPanel event={assigned} />);

    choose("cancelled");
    fireEvent.change(screen.getByLabelText("Reason (required)"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("A reason is required to cancel an event.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("174-S2 SCRUM-174/AC2: cancels the event with its reason and shows it as Cancelled", async () => {
    const fetchMock = mockServer(200, { id: "evt-1", name: "Tech Summit", status: "cancelled" });
    render(<EventStatusPanel event={assigned} />);

    choose("cancelled");
    fireEvent.change(screen.getByLabelText("Reason (required)"), { target: { value: "Organiser withdrew the event" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Status updated to Cancelled.")).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ status: "cancelled", reason: "Organiser withdrew the event" });
  });

  it("174-S10 SCRUM-174/AC7: offers no status change for a cancelled event, and says why", () => {
    render(<EventStatusPanel event={{ ...assigned, status: "cancelled" }} />);

    expect(screen.queryByRole("combobox", { name: "New status" })).toBeNull();
    expect(screen.getByText("This event was cancelled, so its status can no longer change.")).toBeTruthy();
  });

  it.each(["completed", "rejected"])("174-S11 SCRUM-174/AC1: does not offer Cancelled for a %s event", (status) => {
    render(<EventStatusPanel event={{ ...assigned, status }} />);

    const options = within(screen.getByRole("combobox", { name: "New status" })).getAllByRole("option").map((o) => o.getAttribute("value"));
    expect(options).not.toContain("cancelled");
    expect(options).toContain(status);
  });
});

// SCRUM-47/AC10 (and SCRUM-24/AC2): event-service refuses a rejection without a reason, so the page asks for one first,
// as it does for a cancellation (SCRUM-174)
describe("SCRUM-47/AC10 — A rejection on the event page needs a reason", () => {
  const assigned = { ...event, status: "planning", canChangeStatus: true };

  it("SCRUM-47/AC10: asks for a reason once Rejected is chosen, and says who will see it", () => {
    render(<EventStatusPanel event={assigned} />);

    fireEvent.change(screen.getByRole("combobox", { name: "New status" }), { target: { value: "rejected" } });

    expect((screen.getByLabelText("Reason (required)") as HTMLTextAreaElement).required).toBe(true);
    expect(screen.getByText("The organiser will be told this reason.")).toBeTruthy();
  });

  it("SCRUM-47/AC10: sends nothing and says so when Rejected is saved without a reason", () => {
    const fetchMock = mockServer(200, {});
    render(<EventStatusPanel event={assigned} />);

    fireEvent.change(screen.getByRole("combobox", { name: "New status" }), { target: { value: "rejected" } });
    fireEvent.change(screen.getByLabelText("Reason (required)"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("A reason is required to reject an event.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
