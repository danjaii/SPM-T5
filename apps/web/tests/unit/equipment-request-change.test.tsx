import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import { EquipmentQueueList } from "@/components/EquipmentQueueList";
import { EquipmentRequestDetail } from "@/components/EquipmentRequestDetail";
import { EventEquipmentRequests } from "@/components/EventEquipmentRequests";
import type {
  EquipmentQueueItemView,
  EquipmentRequestDetailView,
  EquipmentRequestFormData,
  EquipmentRequestView,
} from "@/lib/equipmentRequests";

// SCRUM-88: the assigned coordinator changes an equipment request (docs/specs/equipment-requests.md). Since SCRUM-136 the
// change is made in the request's row on the event's Equipment tab.

const form: EquipmentRequestFormData = {
  event: { id: "evt-1", name: "Tech Summit" },
  equipment: [
    { id: "eq-mic", label: "Audio: Wireless Microphone Set" },
    { id: "eq-projector", label: "AV: Projector Unit" },
  ],
  venues: [
    { id: "vb-hall", venueName: "Grand Hall", date: "2026-10-15", startTime: "09:00", endTime: "17:00" },
    { id: "vb-annex", venueName: "Annex", date: "2026-10-16", startTime: "09:00", endTime: "13:00" },
  ],
};

const aRequest = (over: Partial<EquipmentRequestView> = {}): EquipmentRequestView => ({
  id: "req-1",
  equipmentId: "eq-projector",
  equipment: "AV: Projector Unit",
  quantity: 2,
  venueName: "Grand Hall",
  venueBookingId: "vb-hall",
  notes: null,
  status: "ARRANGED",
  statusLabel: "Arranged",
  reason: null,
  releasedReason: null,
  canEdit: true,
  lastChangedBy: null,
  lastChangedAt: null,
  ...over,
});

function mockServer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const views = (requests: EquipmentRequestView[], canCreate = true) => ({ requests, canCreate, readiness: null, readinessLabel: null });

/** Opens the request's row for changing, as the coordinator does with its Change button. */
const openChange = (over: Partial<EquipmentRequestView> = {}) => {
  render(<EventEquipmentRequests data={views([aRequest(over)])} form={form} />);
  fireEvent.click(screen.getByRole("button", { name: "Change the AV: Projector Unit request" }));
};
const quantity = () => screen.getByRole("textbox", { name: "Quantity" }) as HTMLInputElement;
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save" }));

beforeEach(() => refresh.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-88/AC2 send it back for review", () => {
  it.each([
    ["UNDER_REVIEW", "Under Review"],
    ["ARRANGED", "Arranged"],
    ["CANNOT_FULFIL", "Cannot Fulfil"],
  ] as const)("a %s request: the form says saving sends it back to Technical Support Staff", (status, statusLabel) => {
    openChange({ status, statusLabel });
    expect(screen.getByRole("status").textContent).toContain(`This request is ${statusLabel}. Saving a change sends it back`);
  });

  it("a Submitted request: nothing to warn about", () => {
    openChange({ status: "SUBMITTED", statusLabel: "Submitted" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("Technical Support Staff see a changed request marked Updated, in the queue and on the request", () => {
    const item: EquipmentQueueItemView = {
      id: "req-1",
      eventId: "evt-1",
      eventName: "Tech Summit",
      eventDate: "2026-10-15",
      venueName: "Grand Hall",
      equipment: "AV: Projector Unit",
      quantity: 2,
      status: "SUBMITTED",
      statusLabel: "Submitted",
      updated: true,
    };
    const { unmount } = render(<EquipmentQueueList requests={[item, { ...item, id: "req-2", updated: false }]} />);
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("Updated")).toBeTruthy();
    expect(within(rows[2]).queryByText("Updated")).toBeNull();
    unmount();

    const detail: EquipmentRequestDetailView = {
      ...item,
      startTime: "09:00",
      endTime: "17:00",
      notes: null,
      reason: null,
      canReview: true,
      lastChangedBy: "Rachel Tan",
      lastChangedAt: "2026-10-15 17:40",
    };
    render(<EquipmentRequestDetail request={detail} />);
    expect(screen.getByText("Updated")).toBeTruthy();
  });
});

describe("SCRUM-88/AC3 wrong information", () => {
  it("nothing is sent when a field is wrong, and what was typed is kept", () => {
    const fetchMock = mockServer(200, {});
    openChange();

    fireEvent.change(quantity(), { target: { value: "1.5" } });
    save();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Quantity must be a whole number of 1 or more")).toBeTruthy();
    expect(quantity().value).toBe("1.5");
  });

  it("a refusal from equipment-service is shown and the row stays, as typed", async () => {
    mockServer(422, { error: "Some fields are invalid.", fieldErrors: { venueBookingId: "Choose the venue." } });
    openChange();
    fireEvent.change(quantity(), { target: { value: "6" } });
    save();

    expect((await screen.findByRole("alert")).textContent).toBe("Some fields are invalid.");
    expect(screen.getByText("Choose the venue.")).toBeTruthy();
    expect(quantity().value).toBe("6");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a general message when the refusal has none, or the server cannot be reached", async () => {
    mockServer(500, {});
    openChange();
    save();
    expect((await screen.findByRole("alert")).textContent).toBe("We couldn't save the item. Please try again.");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    save();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("We couldn't reach the server. Please try again."));
  });
});

describe("SCRUM-88/AC1, AC4, AC6 the Change button on the event page", () => {
  it("shows Change on each request the viewer may change, and no column when none", () => {
    const { unmount } = render(
      <EventEquipmentRequests
        data={views([aRequest(), aRequest({ id: "req-2", canEdit: false, status: "RELEASED", statusLabel: "Released" })])}
        form={form}
      />,
    );
    expect(screen.getAllByRole("button", { name: /^Change the/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Change the AV: Projector Unit request" })).toBeTruthy();
    unmount();

    // AC4, AC6: a finished event, or someone other than the assigned coordinator
    render(<EventEquipmentRequests data={views([aRequest({ canEdit: false })], false)} form={null} />);
    expect(screen.queryByRole("button", { name: /Change the/ })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Actions" })).toBeNull();
  });
});

describe("SCRUM-88/AC8 who changed it", () => {
  it("the event page shows who last changed a request, and when", () => {
    render(
      <EventEquipmentRequests
        data={views([aRequest({ lastChangedBy: "Rachel Tan", lastChangedAt: "2026-10-15 17:40" }), aRequest({ id: "req-2" })])}
        form={form}
      />,
    );
    expect(screen.getAllByText(/Last changed by/)).toHaveLength(1);
    expect(screen.getByText(/Last changed by Rachel Tan, 2026-10-15 17:40/)).toBeTruthy();
  });

  it("the request detail shows who last changed it, and nothing when it has not been changed", () => {
    const detail: EquipmentRequestDetailView = {
      id: "req-1",
      eventId: "evt-1",
      eventName: "Tech Summit",
      eventDate: "2026-10-15",
      venueName: "Grand Hall",
      equipment: "AV: Projector Unit",
      quantity: 2,
      status: "UNDER_REVIEW",
      statusLabel: "Under Review",
      updated: false,
      startTime: "09:00",
      endTime: "17:00",
      notes: null,
      reason: null,
      canReview: true,
      lastChangedBy: "Rachel Tan",
      lastChangedAt: "2026-10-15 17:40",
    };
    const { unmount } = render(<EquipmentRequestDetail request={detail} />);
    expect(screen.getByText("Last changed")).toBeTruthy();
    expect(screen.getByText("Rachel Tan, 2026-10-15 17:40")).toBeTruthy();
    expect(screen.queryByText("Updated")).toBeNull();
    unmount();

    render(<EquipmentRequestDetail request={{ ...detail, lastChangedBy: null, lastChangedAt: null }} />);
    expect(screen.queryByText("Last changed")).toBeNull();
  });
});
