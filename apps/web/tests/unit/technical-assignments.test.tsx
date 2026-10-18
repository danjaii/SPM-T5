import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }), redirect: vi.fn() }));

const { getTechnicalAssignmentForm } = vi.hoisted(() => ({ getTechnicalAssignmentForm: vi.fn() }));
vi.mock("@/lib/technicalAssignmentsServer", () => ({ getTechnicalAssignmentForm }));

import type { NotificationItem } from "@spm-t5/shared";
import ChangeAssignmentPage from "@/app/events/[id]/technical-assignments/[assignmentId]/change/page";
import NewAssignmentPage from "@/app/events/[id]/technical-assignments/new/page";
import { EventTechnicalAssignments } from "@/components/EventTechnicalAssignments";
import { NotificationList } from "@/components/NotificationList";
import { TechnicalAssignmentForm } from "@/components/TechnicalAssignmentForm";
import type { EventTechnicalAssignmentsView, TechnicalAssignmentView } from "@/lib/technicalAssignments";

// ----------------------------------------------------------------------------
// Test setup (docs/specs/technical-assignment-notifications.md): "Tech Summit" (evt-1) has two approved venue bookings
// (Grand Hall 09:00-17:00 and Lotus Room 13:00-17:00 on 15 Oct 2099); Aaron Koh is assigned to the Grand Hall.
// ----------------------------------------------------------------------------

const assignment = (over: Partial<TechnicalAssignmentView> = {}): TechnicalAssignmentView => ({
  id: "asg-1",
  staffId: "tech-1",
  staffName: "Aaron Koh",
  venueBookingId: "vb-hall",
  venueName: "Grand Hall",
  startDate: "2099-10-15",
  startTime: "08:00",
  endDate: "2099-10-15",
  endTime: "17:00",
  note: "Livestream desk",
  status: "ASSIGNED",
  statusLabel: "Assigned",
  acknowledgedAt: null,
  cancelledAt: null,
  cancellationReason: null,
  ...over,
});

const data = (over: Partial<EventTechnicalAssignmentsView> = {}): EventTechnicalAssignmentsView => ({
  assignments: [assignment()],
  canAssign: true,
  staff: [
    { id: "tech-1", name: "Aaron Koh" },
    { id: "tech-2", name: "Vanessa Lee" },
  ],
  venues: [
    { id: "vb-hall", venueName: "Grand Hall", date: "2099-10-15", startTime: "09:00", endTime: "17:00" },
    { id: "vb-lotus", venueName: "Lotus Room", date: "2099-10-15", startTime: "13:00", endTime: "17:00" },
  ],
  ...over,
});

function mockServer(...answers: [number, unknown][]) {
  const fetchMock = vi.fn();
  for (const [status, body] of answers) fetchMock.mockResolvedValueOnce({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const sent = (fetchMock: ReturnType<typeof vi.fn>, call = 0) => ({
  url: fetchMock.mock.calls[call][0] as string,
  method: fetchMock.mock.calls[call][1].method as string,
  body: JSON.parse(fetchMock.mock.calls[call][1].body as string),
});

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

// end of test setup

describe("SCRUM-20/AC5 the event page lists the on-site assignments (20-S10)", () => {
  it("20-S10: each assignment shows the technician, venue, date and time, note and status", () => {
    render(<EventTechnicalAssignments eventId="evt-1" data={data()} />);

    const section = within(screen.getByRole("region", { name: "On-site technical support" }));
    const row = section.getAllByRole("row")[1];
    expect(row.textContent).toContain("Aaron Koh");
    expect(row.textContent).toContain("Grand Hall");
    expect(row.textContent).toContain("2099-10-15 08:00–17:00");
    expect(row.textContent).toContain("Livestream desk");
    expect(row.textContent).toContain("Assigned");
    expect(section.getByRole("link", { name: "Assign technical support staff" }).getAttribute("href")).toBe(
      "/events/evt-1/technical-assignments/new",
    );
  });

  it("20-S10: an acknowledged one says when; a cancelled one says why and has no actions", () => {
    const assignments = [
      assignment({ status: "ACKNOWLEDGED", statusLabel: "Acknowledged", acknowledgedAt: "2099-10-01T02:00:00.000Z" }),
      assignment({ id: "asg-2", status: "CANCELLED", statusLabel: "Cancelled", cancelledAt: "2099-10-02T00:00:00Z", cancellationReason: "Moved online" }),
    ];
    render(<EventTechnicalAssignments eventId="evt-1" data={data({ assignments })} />);

    const [, acknowledged, cancelled] = screen.getAllByRole("row");
    expect(acknowledged.textContent).toContain("Acknowledged on 2099-10-01 10:00");
    expect(within(acknowledged).getByRole("link", { name: "Change" }).getAttribute("href")).toBe(
      "/events/evt-1/technical-assignments/asg-1/change",
    );
    expect(cancelled.textContent).toContain("Cancelled: Moved online");
    expect(within(cancelled).queryByRole("link", { name: "Change" })).toBeNull();
    expect(within(cancelled).queryByRole("button", { name: "Cancel assignment" })).toBeNull();
  });

  it("20-S10: with none, it says so; a finished event offers no Assign, Change or Cancel; no data, no section", () => {
    const { rerender } = render(<EventTechnicalAssignments eventId="evt-1" data={data({ assignments: [] })} />);
    expect(screen.getByText("No technical support staff assigned yet.")).toBeTruthy();

    rerender(<EventTechnicalAssignments eventId="evt-1" data={data({ canAssign: false })} />);
    expect(screen.queryByRole("link", { name: "Assign technical support staff" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Change" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel assignment" })).toBeNull();

    rerender(<EventTechnicalAssignments eventId="evt-1" data={null} />);
    expect(screen.queryByRole("region", { name: "On-site technical support" })).toBeNull();
  });
});

describe("SCRUM-20/AC3 cancelling from the event page (20-S6)", () => {
  it("20-S6: asks for a reason, sends it, and refreshes the page", async () => {
    const fetchMock = mockServer([200, assignment({ status: "CANCELLED" })]);
    render(<EventTechnicalAssignments eventId="evt-1" data={data()} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel assignment" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm cancel" }));
    expect(await screen.findByText("Give a reason for cancelling.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    change("Reason for cancelling", "Event moved online");
    fireEvent.click(screen.getByRole("button", { name: "Confirm cancel" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(sent(fetchMock)).toMatchObject({ method: "POST", body: { reason: "Event moved online" } });
    expect(sent(fetchMock).url).toMatch(/\/technical-assignments\/asg-1\/cancel$/);
  });

  it("20-S7: a refusal is shown, and Keep it closes the box without sending", async () => {
    mockServer([409, { code: "ASSIGNMENT_CANCELLED", error: "This assignment has been cancelled, so it can no longer be changed." }]);
    render(<EventTechnicalAssignments eventId="evt-1" data={data()} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel assignment" }));
    change("Reason for cancelling", "x");
    fireEvent.click(screen.getByRole("button", { name: "Confirm cancel" }));
    expect(await screen.findByText("This assignment has been cancelled, so it can no longer be changed.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.queryByLabelText("Reason for cancelling")).toBeNull();
  });
});

describe("SCRUM-20/AC1 the assign form (20-S1, 20-S12)", () => {
  it("20-S12: choosing a venue booking fills in its date and times, which can still be changed", () => {
    render(<TechnicalAssignmentForm eventId="evt-1" data={data()} />);

    change("Venue booking", "vb-lotus");

    expect(box("Start date").value).toBe("2099-10-15");
    expect(box("Start time").value).toBe("13:00");
    expect(box("End time").value).toBe("17:00");
    change("Start time", "12:00");
    expect(box("Start time").value).toBe("12:00");
  });

  it("20-S12: problems are shown beside their fields, and nothing is sent", async () => {
    const fetchMock = mockServer();
    render(<TechnicalAssignmentForm eventId="evt-1" data={data()} />);

    fireEvent.click(screen.getByRole("button", { name: "Assign" }));

    expect(await screen.findByText("Choose a technical support staff member.")).toBeTruthy();
    expect(screen.getByText("Choose one of the event's approved venue bookings.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("20-S1: assigning sends the form and goes back to the event page", async () => {
    const fetchMock = mockServer([201, assignment()]);
    render(<TechnicalAssignmentForm eventId="evt-1" data={data()} />);

    change("Technical support staff", "tech-2");
    change("Venue booking", "vb-hall");
    change("Note (optional)", "Mic checks");
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/events/evt-1"));
    expect(sent(fetchMock)).toMatchObject({
      method: "POST",
      body: { staffId: "tech-2", venueBookingId: "vb-hall", startDate: "2099-10-15", startTime: "09:00", endDate: "2099-10-15", endTime: "17:00", note: "Mic checks" },
    });
    expect(sent(fetchMock).url).toMatch(/\/events\/evt-1\/technical-assignments$/);
  });

  it("20-S3: the service's refusal and its field messages are shown, and the page stays", async () => {
    mockServer([409, { code: "ALREADY_ASSIGNED", error: "This technician is already assigned to that venue booking." }], [
      422,
      { code: "VALIDATION_FAILED", error: "Some fields are invalid.", fieldErrors: { venueBookingId: "Choose one of the event's approved venue bookings." } },
    ]);
    render(<TechnicalAssignmentForm eventId="evt-1" data={data()} />);
    change("Technical support staff", "tech-1");
    change("Venue booking", "vb-hall");

    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    expect(await screen.findByText("This technician is already assigned to that venue booking.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    expect(await screen.findByText("Choose one of the event's approved venue bookings.")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it("20-S4: changing starts from the assignment, does not offer another technician, and sends a PATCH", async () => {
    const fetchMock = mockServer([200, assignment()]);
    render(<TechnicalAssignmentForm eventId="evt-1" data={data()} assignment={assignment()} />);

    expect(screen.queryByLabelText("Technical support staff")).toBeNull();
    expect(screen.getByText("Aaron Koh")).toBeTruthy();
    expect(box("Start time").value).toBe("08:00");
    change("End time", "18:00");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/events/evt-1"));
    expect(sent(fetchMock)).toMatchObject({ method: "PATCH", body: { venueBookingId: "vb-hall", endTime: "18:00", note: "Livestream desk" } });
    expect(sent(fetchMock).url).toMatch(/\/technical-assignments\/asg-1$/);
  });

  it("20-S12: a network failure says so", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<TechnicalAssignmentForm eventId="evt-1" data={data()} assignment={assignment()} />);

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("We couldn't reach the server. Please try again.")).toBeTruthy();
  });
});

describe("SCRUM-20 the assign and change pages", () => {
  it("20-S12: the new page shows the form, or equipment-service's refusal", async () => {
    getTechnicalAssignmentForm.mockResolvedValueOnce({ data: data() });
    render(await NewAssignmentPage({ params: Promise.resolve({ id: "evt-1" }) }));
    expect(screen.getByRole("heading", { name: "Assign technical support staff" })).toBeTruthy();

    getTechnicalAssignmentForm.mockResolvedValueOnce({ error: "You are not allowed to do that." });
    render(await NewAssignmentPage({ params: Promise.resolve({ id: "evt-1" }) }));
    expect(screen.getByRole("alert").textContent).toBe("You are not allowed to do that.");
  });

  it("20-S4: the change page shows the assignment's form; a missing or cancelled one says it can't be changed", async () => {
    getTechnicalAssignmentForm.mockResolvedValue({
      data: data({ assignments: [assignment(), assignment({ id: "asg-2", status: "CANCELLED", cancelledAt: "2099-10-02T00:00:00Z" })] }),
    });

    render(await ChangeAssignmentPage({ params: Promise.resolve({ id: "evt-1", assignmentId: "asg-1" }) }));
    expect(screen.getByRole("heading", { name: "Change on-site assignment" })).toBeTruthy();

    for (const assignmentId of ["asg-2", "asg-missing"]) {
      const { container } = render(await ChangeAssignmentPage({ params: Promise.resolve({ id: "evt-1", assignmentId }) }));
      expect(within(container).getByRole("alert").textContent).toBe("This assignment can't be changed.");
    }

    getTechnicalAssignmentForm.mockResolvedValueOnce({ error: "Event not found." });
    const { container } = render(await ChangeAssignmentPage({ params: Promise.resolve({ id: "evt-1", assignmentId: "asg-1" }) }));
    expect(within(container).getByRole("alert").textContent).toBe("Event not found.");
  });
});

describe("SCRUM-20/AC4, AC5 acknowledging on the notification page (20-S8, 20-S11)", () => {
  const note = (over: Partial<NotificationItem> = {}): NotificationItem => ({
    id: "n-1",
    type: "technical_assignment_assigned",
    title: "You are assigned to support an event on-site",
    message: "Tech Summit at Grand Hall, 15 Oct 2099 08:00 to 17:00 (Singapore time).",
    isRead: false,
    createdAt: "2099-10-01T01:00:00.000Z",
    readAt: null,
    related: null,
    actionRequired: false,
    acknowledgement: { canAcknowledge: true, acknowledgedAt: null },
    ...over,
  });

  it("20-S11: an assignment notification that can be acknowledged has an Acknowledge button; others do not", () => {
    render(
      <NotificationList
        items={[note(), note({ id: "n-2", type: "event_submitted", acknowledgement: undefined }), note({ id: "n-3", acknowledgement: { canAcknowledge: false, acknowledgedAt: null } })]}
      />,
    );

    expect(screen.getAllByRole("button", { name: "Acknowledge" })).toHaveLength(1);
  });

  it("20-S8: Acknowledge sends it, then shows it acknowledged and read", async () => {
    const fetchMock = mockServer([200, note({ isRead: true, acknowledgement: { canAcknowledge: false, acknowledgedAt: "2099-10-01T02:00:00.000Z" } })]);
    render(<NotificationList items={[note()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));

    expect(await screen.findByText("Acknowledged on 2099-10-01 10:00")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Acknowledge" })).toBeNull();
    expect(screen.getByText("0 unread")).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/notifications\/n-1\/acknowledge$/);
    expect(refresh).toHaveBeenCalled();
  });

  it("20-S9: a refusal is shown and the button stays", async () => {
    mockServer([409, { code: "OUT_OF_DATE", error: "This assignment changed since this notification. Acknowledge the newer one." }]);
    render(<NotificationList items={[note()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));

    expect(await screen.findByText("This assignment changed since this notification. Acknowledge the newer one.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Acknowledge" })).toBeTruthy();
  });
});

describe("SCRUM-20 fallbacks: missing names, other days, and unexplained refusals", () => {
  it("20-S10: an assignment ending on another day shows the end date; missing names and note show placeholders", () => {
    const odd = assignment({ endDate: "2099-10-16", staffName: null, venueName: null, note: null });
    const cancelled = assignment({ id: "asg-2", status: "CANCELLED", statusLabel: "Cancelled", cancellationReason: null });
    render(<EventTechnicalAssignments eventId="evt-1" data={data({ assignments: [odd, cancelled] })} />);

    const [, row, cancelledRow] = screen.getAllByRole("row");
    expect(row.textContent).toContain("2099-10-15 08:00–2099-10-16 17:00");
    expect(row.textContent).toContain("Unknown");
    expect(row.textContent).toContain("No venue");
    expect(row.textContent).toContain("—");
    expect(cancelledRow.textContent).toContain("Cancelled");
  });

  it("20-S6: a reason the service refuses is shown; an unexplained refusal gets a general message", async () => {
    mockServer([422, { code: "VALIDATION_FAILED", fieldErrors: { reason: "Keep the reason to 500 characters or fewer." } }], [500, {}]);
    render(<EventTechnicalAssignments eventId="evt-1" data={data()} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel assignment" }));
    change("Reason for cancelling", "x");

    fireEvent.click(screen.getByRole("button", { name: "Confirm cancel" }));
    expect(await screen.findByText("Keep the reason to 500 characters or fewer.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm cancel" }));
    expect(await screen.findByText("We couldn't cancel the assignment. Please try again.")).toBeTruthy();
  });

  it("20-S12: clearing the venue booking leaves the times as they were; an unexplained refusal gets a general message", async () => {
    mockServer([500, {}]);
    render(<TechnicalAssignmentForm eventId="evt-1" data={data()} assignment={assignment({ staffName: null })} />);
    expect(screen.getByText("Unknown")).toBeTruthy();

    change("Venue booking", "");
    expect(box("Start time").value).toBe("08:00");
    change("Venue booking", "vb-hall");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("We couldn't save the assignment. Please try again.")).toBeTruthy();
  });

  it("20-S9: acknowledging with no reply message, or no network, still says what went wrong", async () => {
    const item: NotificationItem = {
      id: "n-1",
      type: "technical_assignment_assigned",
      title: "Assigned",
      message: "m",
      isRead: false,
      createdAt: "2099-10-01T01:00:00.000Z",
      readAt: null,
      related: null,
      actionRequired: false,
      acknowledgement: { canAcknowledge: true, acknowledgedAt: null },
    };
    mockServer([500, {}]);
    render(<NotificationList items={[item]} />);
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(await screen.findByText("We couldn't acknowledge that notification. Please try again.")).toBeTruthy();

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(await screen.findByText("We couldn't reach the server. Please try again.")).toBeTruthy();
  });
});

