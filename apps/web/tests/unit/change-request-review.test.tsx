import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }), redirect: vi.fn() }));

const { getChangeRequestReview } = vi.hoisted(() => ({ getChangeRequestReview: vi.fn() }));
vi.mock("@/lib/changeRequestReviewServer", () => ({ getChangeRequestReview }));

import ChangeRequestPage from "@/app/change-requests/[id]/page";
import { changeValue } from "@/components/EventChangeHistory";
import { ChangeRequestReview } from "@/components/ChangeRequestReview";
import { EventChangeRequestList } from "@/components/EventChangeRequestList";
import type { ChangeRequestReviewView } from "@/lib/changeRequestReview";
import type { ChangeRequestView } from "@/lib/events";

// ----------------------------------------------------------------------------
// Test setup (docs/specs/review-change-request.md): "Tech Summit" (evt-1) for 120 people; its organiser asked to raise the
// attendance to 150 and move the start to 13 Dec. Orchid Hall (holds 130) would no longer be big enough.
// ----------------------------------------------------------------------------

const listItem = (over: Partial<ChangeRequestView> = {}): ChangeRequestView => ({
  id: "cr-1",
  change_description: "Changed: expected attendance",
  proposed_changes: null,
  status: "pending",
  requested_at: "2099-10-01T00:00:00Z",
  review_notes: null,
  ...over,
});

const review = (over: Partial<ChangeRequestReviewView> = {}): ChangeRequestReviewView => ({
  id: "cr-1",
  eventId: "evt-1",
  eventName: "Tech Summit",
  status: "pending",
  changeDescription: "More people are coming",
  requestedAt: "2099-10-01T00:00:00Z",
  reviewedAt: null,
  reviewNotes: null,
  rows: [
    { field: "preferred_start_datetime", label: "Start", current: "2099-12-12T01:00:00Z", requested: "2099-12-13T01:00:00Z", changedSince: false, supported: true },
    { field: "expected_attendance", label: "Expected attendance", current: 120, requested: 150, changedSince: false, supported: true },
  ],
  outdated: false,
  unsupported: [],
  canApprove: true,
  canReject: true,
  affected: [
    {
      kind: "venue_booking",
      id: "vb-orchid",
      name: "Orchid Hall",
      quantity: null,
      start: "2099-12-12T02:00:00Z",
      end: "2099-12-12T04:00:00Z",
      statusLabel: "Approved",
      reasons: ["Orchid Hall holds 130 people, but the event now expects 150. The venue may no longer be suitable."],
    },
  ],
  ...over,
});

function mockServer(...answers: [number, unknown][]) {
  const fetchMock = vi.fn();
  for (const [status, body] of answers) fetchMock.mockResolvedValueOnce({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

// end of test setup

describe("SCRUM-67/AC1 the event page says a request awaits review (67-S1)", () => {
  it("67-S1: the assigned coordinator sees that a request awaits their review, with a link to review each", () => {
    render(<EventChangeRequestList requests={[listItem(), listItem({ id: "cr-2", status: "approved" })]} reviewable />);

    expect(screen.getByRole("status").textContent).toBe("A change request is awaiting your review.");
    const links = screen.getAllByRole("link", { name: "Review" });
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/change-requests/cr-1", "/change-requests/cr-2"]);
  });

  it("67-S1: with nothing pending there is no notice; the organiser sees no Review links", () => {
    const { rerender } = render(<EventChangeRequestList requests={[listItem({ status: "rejected" })]} reviewable />);
    expect(screen.queryByRole("status")).toBeNull();

    rerender(<EventChangeRequestList requests={[listItem()]} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("link", { name: "Review" })).toBeNull();
  });
});

describe("SCRUM-67/AC2 each requested change with the current value (67-S2)", () => {
  it("67-S2: lists each change as its label, the current value and the requested value", () => {
    render(<ChangeRequestReview review={review()} />);

    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((r) => [...r.querySelectorAll("td, th")].map((c) => c.textContent))).toEqual([
      ["Start", changeValue("preferred_start_datetime", "2099-12-12T01:00:00Z"), changeValue("preferred_start_datetime", "2099-12-13T01:00:00Z")],
      ["Expected attendance", "120", "150"],
    ]);
    expect(screen.getByText("More people are coming")).toBeTruthy();
  });

  it("67-S5: a field changed since the request is marked, and the outdated message replaces Approve", () => {
    const rows = [{ field: "expected_attendance", label: "Expected attendance", current: 130, requested: 150, changedSince: true, supported: true }];
    render(<ChangeRequestReview review={review({ rows, outdated: true, canApprove: false })} />);

    expect(screen.getByText("Changed since the request")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("The event has changed since this request was made");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
  });

  it("67-S5: a change the system cannot apply is marked and explained", () => {
    const rows = [{ field: "registration_capacity", label: "Registration capacity", current: null, requested: 38, changedSince: false, supported: false }];
    render(<ChangeRequestReview review={review({ rows, unsupported: ["registration_capacity"], canApprove: false })} />);

    expect(screen.getByText("Can't be applied")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("includes a change the system can't apply");
  });
});

describe("SCRUM-67/AC3, AC6 approving, after confirming (67-S3, 67-S4, 67-S8)", () => {
  it("67-S4, 67-S8: Approve asks first, listing the affected arrangements; Cancel sends nothing", () => {
    const fetchMock = mockServer();
    render(<ChangeRequestReview review={review()} />);

    click("Approve");

    const box = within(screen.getByRole("region", { name: "Confirm approval" }));
    expect(box.getByText("Venue booking: Orchid Hall")).toBeTruthy();
    expect(box.getByText(/The venue may no longer be suitable/)).toBeTruthy();
    expect(box.getByText(/will be sent back for review/)).toBeTruthy();
    click("Cancel");
    expect(screen.queryByRole("region", { name: "Confirm approval" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("67-S3: Confirm approval sends it, says so and refreshes the page", async () => {
    const fetchMock = mockServer([200, { status: "approved", message: "Change request approved. The event has been updated." }]);
    render(<ChangeRequestReview review={review({ affected: [] })} />);

    click("Approve");
    expect(screen.queryByText(/will be sent back for review/)).toBeNull();
    click("Confirm approval");

    expect(await screen.findByText("Change request approved. The event has been updated.")).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/change-requests\/cr-1\/approve$/);
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  });

  it("67-S5: a refusal is shown in the service's words", async () => {
    mockServer([409, { code: "OUTDATED", error: "The event has changed since this request was made." }]);
    render(<ChangeRequestReview review={review()} />);

    click("Approve");
    click("Confirm approval");

    expect(await screen.findByText("The event has changed since this request was made.")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("SCRUM-67/AC4, AC5, AC6 rejecting with a reason, after confirming (67-S6, 67-S7, 67-S8)", () => {
  it("67-S6: the reason is required before anything is sent", async () => {
    const fetchMock = mockServer();
    render(<ChangeRequestReview review={review()} />);

    click("Reject");
    click("Confirm rejection");

    expect(await screen.findByText("Give a reason for rejecting this request.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("67-S7: Confirm rejection sends the reason and refreshes", async () => {
    const fetchMock = mockServer([200, { status: "rejected", message: "Change request rejected. The event is unchanged." }]);
    render(<ChangeRequestReview review={review()} />);

    click("Reject");
    fireEvent.change(screen.getByLabelText("Reason for rejecting"), { target: { value: "The hall cannot hold 150" } });
    click("Confirm rejection");

    expect(await screen.findByText("Change request rejected. The event is unchanged.")).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ reason: "The hall cannot hold 150" });
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/change-requests\/cr-1\/reject$/);
    expect(refresh).toHaveBeenCalled();
  });

  it("67-S8: Cancel closes the box without sending; a service refusal on the reason is shown", async () => {
    const fetchMock = mockServer([422, { code: "VALIDATION_FAILED", fieldErrors: { reason: "Keep the reason to 2000 characters or fewer." } }]);
    render(<ChangeRequestReview review={review()} />);

    click("Reject");
    click("Cancel");
    expect(screen.queryByLabelText("Reason for rejecting")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    click("Reject");
    fireEvent.change(screen.getByLabelText("Reason for rejecting"), { target: { value: "x" } });
    click("Confirm rejection");
    expect(await screen.findByText("Keep the reason to 2000 characters or fewer.")).toBeTruthy();
  });
});

describe("SCRUM-67/AC8 a decided request (67-S10)", () => {
  it("67-S10: shows its outcome and reason, and offers no Approve or Reject", () => {
    render(
      <ChangeRequestReview
        review={review({ status: "rejected", reviewNotes: "The hall cannot hold 150", reviewedAt: "2099-10-02T02:00:00Z", canApprove: false, canReject: false })}
      />,
    );

    expect(screen.getByText("Rejected on 2099-10-02 10:00: The hall cannot hold 150")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  });

  it("67-S10: an approved one says when", () => {
    render(<ChangeRequestReview review={review({ status: "approved", reviewedAt: "2099-10-02T02:00:00Z", canApprove: false, canReject: false })} />);

    expect(screen.getByText("Approved on 2099-10-02 10:00")).toBeTruthy();
  });
});

describe("SCRUM-67 the review page", () => {
  it("67-S2, 67-S9: shows the review, or event-service's refusal", async () => {
    getChangeRequestReview.mockResolvedValueOnce({ review: review() });
    render(await ChangeRequestPage({ params: Promise.resolve({ id: "cr-1" }) }));
    expect(screen.getByRole("heading", { name: "Change request for Tech Summit" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "← Back to event" }).getAttribute("href")).toBe("/events/evt-1");

    getChangeRequestReview.mockResolvedValueOnce({ error: "Only the event's assigned coordinator can review its change requests." });
    const { container } = render(await ChangeRequestPage({ params: Promise.resolve({ id: "cr-1" }) }));
    expect(within(container).getByRole("alert").textContent).toBe("Only the event's assigned coordinator can review its change requests.");
  });
});
