import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookieValue, push, redirect, refresh } = vi.hoisted(() => ({
  cookieValue: { current: "token-coord" as string | undefined },
  push: vi.fn(),
  refresh: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));
vi.mock("next/navigation", () => ({ redirect, useRouter: () => ({ push, refresh }) }));

import ChangeEquipmentRequestPage from "@/app/events/[id]/equipment-request/[requestId]/page";
import { EquipmentQueueList } from "@/components/EquipmentQueueList";
import { EquipmentRequestDetail } from "@/components/EquipmentRequestDetail";
import { EquipmentRequestForm } from "@/components/EquipmentRequestForm";
import { EventEquipmentRequests } from "@/components/EventEquipmentRequests";
import type {
  EquipmentQueueItemView,
  EquipmentRequestDetailView,
  EquipmentRequestEditFormData,
  EquipmentRequestView,
} from "@/lib/equipmentRequests";
import { getEquipmentRequestEditForm } from "@/lib/equipmentRequestsServer";

// SCRUM-88: the assigned coordinator changes an equipment request (docs/specs/equipment-requests.md).

const editForm = (request: Partial<EquipmentRequestEditFormData["request"]> = {}): EquipmentRequestEditFormData => ({
  event: { id: "evt-1", name: "Tech Summit" },
  equipment: [
    { id: "eq-mic", label: "Audio: Wireless Microphone Set" },
    { id: "eq-projector", label: "AV: Projector Unit" },
  ],
  venues: [
    { id: "vb-hall", venueName: "Grand Hall", date: "2026-10-15", startTime: "09:00", endTime: "17:00" },
    { id: "vb-annex", venueName: "Annex", date: "2026-10-16", startTime: "09:00", endTime: "13:00" },
  ],
  request: {
    id: "req-1",
    equipmentId: "eq-projector",
    quantity: 2,
    venueBookingId: "vb-hall",
    notes: "Front row",
    status: "SUBMITTED",
    statusLabel: "Submitted",
    ...request,
  },
});

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

const renderForm = (form = editForm()) => render(<EquipmentRequestForm form={form} existing={form.request} />);
const equipment = () => screen.getByLabelText("Equipment") as HTMLSelectElement;
const quantity = () => screen.getByLabelText("Quantity") as HTMLInputElement;
const venue = () => screen.getByLabelText("Venue") as HTMLSelectElement;
const notes = () => screen.getByLabelText("Technical notes (optional)") as HTMLTextAreaElement;
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  cookieValue.current = "token-coord";
});
afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-88/AC1 edit a request", () => {
  it("the form starts on the request's current details", () => {
    renderForm();
    expect(screen.getByRole("heading", { name: "Change equipment request" })).toBeTruthy();
    expect(equipment().value).toBe("eq-projector");
    expect(quantity().value).toBe("2");
    expect(venue().value).toBe("vb-hall");
    expect(notes().value).toBe("Front row");
  });

  it("an item or venue no longer offered starts unchosen, so the coordinator picks again", () => {
    renderForm(editForm({ equipmentId: "eq-retired", venueBookingId: "vb-gone", notes: null }));
    expect(equipment().value).toBe("");
    expect(venue().value).toBe("");
    expect(notes().value).toBe("");
  });

  it("saves the new details to equipment-service and returns to the event", async () => {
    const fetchMock = mockServer(200, aRequest({ status: "SUBMITTED" }));
    renderForm();

    fireEvent.change(equipment(), { target: { value: "eq-mic" } });
    fireEvent.change(quantity(), { target: { value: "6" } });
    fireEvent.change(venue(), { target: { value: "vb-annex" } });
    fireEvent.change(notes(), { target: { value: "Two more on stage" } });
    save();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/events/evt-1"));
    expect(refresh).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4004/events/evt-1/equipment-requests/req-1",
      expect.objectContaining({ method: "PATCH", credentials: "include" }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      equipmentId: "eq-mic",
      quantity: "6",
      venueBookingId: "vb-annex",
      notes: "Two more on stage",
    });
  });
});

describe("SCRUM-88/AC2 send it back for review", () => {
  it.each([
    ["UNDER_REVIEW", "Under Review"],
    ["ARRANGED", "Arranged"],
    ["CANNOT_FULFIL", "Cannot Fulfil"],
  ] as const)("a %s request: the form says saving sends it back to Technical Support Staff", (status, statusLabel) => {
    renderForm(editForm({ status, statusLabel }));
    expect(screen.getByRole("status").textContent).toContain(`This request is ${statusLabel}. Saving a change sends it back`);
  });

  it("a Submitted request: nothing to warn about", () => {
    renderForm();
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
    renderForm();

    fireEvent.change(equipment(), { target: { value: "" } });
    fireEvent.change(quantity(), { target: { value: "1.5" } });
    save();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Choose the equipment.")).toBeTruthy();
    expect(screen.getByText("Quantity must be a whole number of 1 or more")).toBeTruthy();
    expect(quantity().value).toBe("1.5");
  });

  it("a refusal from equipment-service is shown and the form stays, as typed", async () => {
    mockServer(422, { error: "Some fields are invalid.", fieldErrors: { venueBookingId: "Choose the venue." } });
    renderForm();
    fireEvent.change(quantity(), { target: { value: "6" } });
    save();

    expect((await screen.findByRole("alert")).textContent).toBe("Some fields are invalid.");
    expect(screen.getByText("Choose the venue.")).toBeTruthy();
    expect(quantity().value).toBe("6");
    expect(push).not.toHaveBeenCalled();
  });

  it("a general message when the refusal has none, or the server cannot be reached", async () => {
    mockServer(500, {});
    renderForm();
    save();
    expect((await screen.findByRole("alert")).textContent).toBe("We couldn't save your changes. Please try again.");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    save();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("We couldn't reach the server. Please try again."));
  });
});

describe("SCRUM-88/AC1, AC4, AC6 the Change link on the event page", () => {
  it("shows Change on each request the viewer may change, and no column when none", () => {
    const { unmount } = render(
      <EventEquipmentRequests
        eventId="evt-1"
        data={{
          requests: [aRequest(), aRequest({ id: "req-2", canEdit: false, status: "RELEASED", statusLabel: "Released" })],
          canCreate: true,
          readiness: null,
          readinessLabel: null,
        }}
      />,
    );
    const link = screen.getByRole("link", { name: "Change the AV: Projector Unit request" });
    expect(link.getAttribute("href")).toBe("/events/evt-1/equipment-request/req-1");
    expect(screen.getAllByRole("link", { name: /^Change the/ })).toHaveLength(1);
    unmount();

    // AC4, AC6: a finished event, or someone other than the assigned coordinator
    render(
      <EventEquipmentRequests
        eventId="evt-1"
        data={{ requests: [aRequest({ canEdit: false })], canCreate: false, readiness: null, readinessLabel: null }}
      />,
    );
    expect(screen.queryByRole("link", { name: /Change the/ })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Actions" })).toBeNull();
  });
});

describe("SCRUM-88/AC8 who changed it", () => {
  it("the event page shows who last changed a request, and when", () => {
    render(
      <EventEquipmentRequests
        eventId="evt-1"
        data={{
          requests: [aRequest({ lastChangedBy: "Rachel Tan", lastChangedAt: "2026-10-15 17:40" }), aRequest({ id: "req-2" })],
          canCreate: true,
          readiness: null,
          readinessLabel: null,
        }}
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

describe("SCRUM-88 the change page (/events/[id]/equipment-request/[requestId])", () => {
  const open = async () =>
    render(await ChangeEquipmentRequestPage({ params: Promise.resolve({ id: "evt-1", requestId: "req-1" }) }));

  it("SCRUM-88/AC1 shows the form on the current details, loaded as the signed-in user", async () => {
    const fetchMock = mockServer(200, editForm());
    await open();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4004/events/evt-1/equipment-requests/req-1/edit-form",
      expect.objectContaining({ headers: { cookie: "cs_session=token-coord" }, cache: "no-store" }),
    );
    expect(screen.getByRole("heading", { name: "Change equipment request" })).toBeTruthy();
    expect(quantity().value).toBe("2");
    expect(screen.getByRole("link", { name: "← Back to event" }).getAttribute("href")).toBe("/events/evt-1");
  });

  it.each([
    [403, "You are not allowed to do that."],
    [409, "Equipment requests for a completed, cancelled or rejected event can't be changed."],
    [409, "Released equipment can't be changed. Request it again for another venue booking."],
  ])("SCRUM-88/AC4, AC6 shows equipment-service's %s refusal instead of the form", async (status, error) => {
    mockServer(status, { error });
    await open();
    expect(screen.getByRole("alert").textContent).toBe(error);
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  });

  it("a general message when the refusal has none, and a message when unreachable", async () => {
    mockServer(500, {});
    expect(await getEquipmentRequestEditForm("evt-1", "req-1")).toEqual({ error: "We couldn't load the equipment request." });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect(await getEquipmentRequestEditForm("evt-1", "req-1")).toEqual({ error: "We couldn't reach the server. Please try again." });
  });

  it("not signed in goes to the sign-in page", async () => {
    cookieValue.current = undefined;
    await expect(getEquipmentRequestEditForm("evt-1", "req-1")).rejects.toThrow("redirect:/login");
  });
});
