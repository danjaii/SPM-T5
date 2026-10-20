import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

import { EventDetailsForm } from "@/components/EventDetailsForm";
import type { EventEditForm } from "@/lib/events";

// ----------------------------------------------------------------------------
// Test setup: "Tech Summit" on Sat 12 Dec 2099, 9am-5pm, 480 people, with Orchid Hall (holds 500) and 2 projectors, both
// 10am-12pm (docs/specs/important-change-impact.md)
// ----------------------------------------------------------------------------

const form: EventEditForm = {
  values: {
    name: "Tech Summit",
    description: "",
    purpose: "",
    categoryId: "",
    date: "2099-12-12",
    startTime: "09:00",
    endDate: "2099-12-12",
    endTime: "17:00",
    expectedAttendance: 480,
    roomLayoutId: "",
    accessibilityRequirements: "",
    venueRequirements: "",
    equipmentRequirements: "",
  },
  categories: [],
  roomLayouts: [],
  importantFields: ["date", "startTime", "endDate", "endTime", "expectedAttendance", "roomLayoutId", "accessibilityRequirements", "venueRequirements", "equipmentRequirements"],
};

/** event-service's answer to an important change that affects arrangements (SCRUM-112/AC1). */
const confirmImpact = {
  code: "CONFIRM_IMPACT",
  error: "This change may affect existing arrangements. Check them before saving.",
  affected: [
    {
      kind: "venue_booking",
      id: "vb-orchid",
      name: "Orchid Hall",
      quantity: null,
      start: "2099-12-12T02:00:00+00:00",
      end: "2099-12-12T04:00:00+00:00",
      statusLabel: "Approved",
      reasons: ["Orchid Hall holds 500 people, but the event now expects 600. This venue booking is for 480. The venue may no longer be suitable."],
    },
    {
      kind: "equipment_request",
      id: "eq-projectors",
      name: "Projector",
      quantity: 2,
      start: "2099-12-12T02:00:00+00:00",
      end: "2099-12-12T04:00:00+00:00",
      statusLabel: "Submitted",
      reasons: ["No longer within the event's new date and time."],
    },
  ],
};

/** The server answers each request in turn. */
function mockServer(...answers: [number, unknown][]) {
  const fetchMock = vi.fn();
  for (const [status, body] of answers) fetchMock.mockResolvedValueOnce({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
});

const sentBody = (fetchMock: ReturnType<typeof vi.fn>, call: number) => JSON.parse(fetchMock.mock.calls[call][1].body as string);

/** The coordinator raises the attendance to 600 and presses Save changes. */
function raiseAttendanceAndSave() {
  render(<EventDetailsForm eventId="evt-1" form={form} />);
  fireEvent.change(screen.getByLabelText("Expected attendance"), { target: { value: "600" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
}

const warning = () => screen.findByRole("dialog", { name: "Check affected arrangements" });

// end of test setup

describe("SCRUM-112/AC1, AC2, AC3 the warning lists the affected arrangements", () => {
  it("112-S1, 112-S2: lists each venue booking and equipment request with its time, status and reason, and stays on the form", async () => {
    mockServer([409, confirmImpact]);

    raiseAttendanceAndSave();

    const panel = within(await warning());
    expect(panel.getByText("This change may affect existing arrangements. Check them before saving.")).toBeTruthy();
    const items = panel.getAllByTestId("affected-item");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("Venue booking: Orchid Hall");
    expect(items[0].textContent).toContain("Sat, 12 Dec 2099, 10:00 AM – 12:00 PM");
    expect(items[0].textContent).toContain("Approved");
    expect(items[0].textContent).toContain("The venue may no longer be suitable.");
    expect(items[1].textContent).toContain("Equipment request: Projector × 2");
    expect(items[1].textContent).toContain("Submitted");
    expect(items[1].textContent).toContain("No longer within the event's new date and time.");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("SCRUM-112/AC5 Save anyway", () => {
  it("112-S14: sends the same edit again with confirmImpact: true, then goes back to the event page", async () => {
    const fetchMock = mockServer([409, confirmImpact], [200, { important: true, message: "Event details saved." }]);
    raiseAttendanceAndSave();

    fireEvent.click(within(await warning()).getByRole("button", { name: "Save anyway" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/events/evt-1?saved=1"));
    expect(sentBody(fetchMock, 0).confirmImpact).toBeUndefined();
    expect(sentBody(fetchMock, 1)).toEqual({ ...sentBody(fetchMock, 0), confirmImpact: true });
  });
});

describe("SCRUM-112/AC4 Go back", () => {
  it("112-S13: closes the warning, sends nothing more and keeps the coordinator's edit in the form", async () => {
    const fetchMock = mockServer([409, confirmImpact]);
    raiseAttendanceAndSave();

    fireEvent.click(within(await warning()).getByRole("button", { name: "Go back" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Expected attendance") as HTMLInputElement).value).toBe("600");
  });

  it("112-S13: changing the form again closes the warning, so Save anyway can't save an edit it did not show", async () => {
    mockServer([409, confirmImpact]);
    raiseAttendanceAndSave();
    await warning();

    fireEvent.change(screen.getByLabelText("Expected attendance", { selector: "input" }), { target: { value: "700" } });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("SCRUM-112/AC6 no warning when nothing is affected", () => {
  it("112-S15: an important change event-service saves straight away goes back to the event page with no warning", async () => {
    mockServer([200, { important: true, message: "Event details saved." }]);

    raiseAttendanceAndSave();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/events/evt-1?saved=1"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("SCRUM-128/AC2, AC3 the warning is a dialog over the form", () => {
  it("SCRUM-128/AC2: Save changes on an important change opens the dialog naming each affected booking and reservation", async () => {
    mockServer([409, confirmImpact]);
    raiseAttendanceAndSave();
    const dialog = within(await warning());
    expect(dialog.getByText("Venue booking: Orchid Hall")).toBeTruthy();
    expect(dialog.getByText("Equipment request: Projector × 2")).toBeTruthy();
  });

  it("SCRUM-128/AC3: Go back returns to the form with nothing saved", async () => {
    const fetchMock = mockServer([409, confirmImpact]);
    raiseAttendanceAndSave();
    fireEvent.click(within(await warning()).getByRole("button", { name: "Go back" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBody(fetchMock, 0).confirmImpact).toBeUndefined();
    expect(push).not.toHaveBeenCalled();
  });
});
