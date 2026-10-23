import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh, toastSuccess } = vi.hoisted(() => ({ refresh: vi.fn(), toastSuccess: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess } }));

import { EventEquipmentRequests } from "@/components/EventEquipmentRequests";
import type { EquipmentRequestFormData, EquipmentRequestView, EventEquipmentRequestsView } from "@/lib/equipmentRequests";

// SCRUM-136: the event's Equipment tab, where the assigned coordinator adds and changes items in one row.

const form: EquipmentRequestFormData = {
  event: { id: "evt-1", name: "Tech Summit" },
  equipment: [
    { id: "eq-mic", label: "Audio: Wireless Microphone Set" },
    { id: "eq-projector", label: "AV: Projector Unit" },
  ],
  venues: [{ id: "vb-hall", venueName: "Grand Hall", date: "2026-10-15", startTime: "09:00", endTime: "17:00" }],
};

const data = (over: Partial<EventEquipmentRequestsView> = {}): EventEquipmentRequestsView => ({
  requests: [],
  canCreate: true,
  readiness: null,
  readinessLabel: null,
  ...over,
});

const aRequest = (over: Partial<EquipmentRequestView> = {}): EquipmentRequestView => ({
  id: "r1",
  equipmentId: "eq-mic",
  equipment: "Audio: Wireless Microphone Set",
  quantity: 4,
  venueName: "Grand Hall",
  venueBookingId: "vb-hall",
  notes: "Two on stage",
  status: "SUBMITTED",
  statusLabel: "Submitted",
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

/** Picks an option from a Base UI select by the text the coordinator sees. */
async function choose(field: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: field }));
  const item = await screen.findByRole("option", { name: option });
  // Base UI ignores a click that follows opening too quickly, as a stray double click would
  await new Promise((resolve) => setTimeout(resolve, 300));
  fireEvent.pointerDown(item);
  fireEvent.mouseDown(item);
  fireEvent.pointerUp(item);
  fireEvent.mouseUp(item);
  fireEvent.click(item);
}

const openAddRow = () => {
  render(<EventEquipmentRequests data={data()} form={form} />);
  fireEvent.click(screen.getByRole("button", { name: "Add item" }));
};

beforeEach(() => {
  refresh.mockClear();
  toastSuccess.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-136/AC1 add an item in one row", () => {
  it("Add item opens one row with equipment, quantity, venue and technical requirements", () => {
    render(<EventEquipmentRequests data={data()} form={form} />);

    fireEvent.click(screen.getByRole("button", { name: "Add item" }));

    const row = screen.getByRole("form", { name: "Add equipment item" });
    expect(within(row).getByRole("combobox", { name: "Equipment" })).toBeTruthy();
    expect(within(row).getByRole("textbox", { name: "Quantity" })).toBeTruthy();
    expect(within(row).getByRole("combobox", { name: "Venue" })).toBeTruthy();
    expect(within(row).getByRole("textbox", { name: "Technical requirements" })).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("Save sends the item to equipment-service, confirms it and refreshes the list", async () => {
    const fetchMock = mockServer(201, { id: "req-1" });
    openAddRow();

    await choose("Equipment", "Audio: Wireless Microphone Set");
    fireEvent.change(screen.getByRole("textbox", { name: "Quantity" }), { target: { value: "4" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Technical requirements" }), { target: { value: "Two on stage" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Equipment request added"));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/events\/evt-1\/equipment-requests$/);
    expect(JSON.parse(init.body)).toEqual({ equipmentId: "eq-mic", quantity: "4", venueBookingId: "vb-hall", notes: "Two on stage" });
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole("form", { name: "Add equipment item" })).toBeNull();
  });

  it("checks the row with the shared rules first: an unchosen item or a bad quantity is marked and nothing is sent", async () => {
    const fetchMock = mockServer(201, {});
    openAddRow();

    fireEvent.change(screen.getByRole("textbox", { name: "Quantity" }), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Choose the equipment.")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Quantity" }).getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByRole("textbox", { name: "Quantity" }) as HTMLInputElement).value).toBe("1.5");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows equipment-service's refusal in the row, marks the field it refused and keeps what was typed", async () => {
    mockServer(422, { error: "Only 2 are available.", fieldErrors: { quantity: "Only 2 are available." } });
    openAddRow();

    await choose("Equipment", "Audio: Wireless Microphone Set");
    fireEvent.change(screen.getByRole("textbox", { name: "Quantity" }), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Only 2 are available.");
    expect(screen.getByRole("textbox", { name: "Quantity" }).getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByRole("textbox", { name: "Quantity" }) as HTMLInputElement).value).toBe("4");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole("form", { name: "Add equipment item" })).toBeTruthy();
  });

  it("Cancel closes the row without sending anything and brings back Add item", () => {
    const fetchMock = mockServer(201, {});
    openAddRow();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("form", { name: "Add equipment item" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add item" })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SCRUM-136/AC1 edit an item in its row", () => {
  const openChangeRow = (request = aRequest()) => {
    render(<EventEquipmentRequests data={data({ requests: [request] })} form={form} />);
    fireEvent.click(screen.getByRole("button", { name: "Change the Audio: Wireless Microphone Set request" }));
    return screen.getByRole("form", { name: "Change equipment item" });
  };

  it("Change opens the same row in place, starting on the item's current details", () => {
    const row = openChangeRow();

    expect(within(row).getByRole("combobox", { name: "Equipment" }).textContent).toContain("Audio: Wireless Microphone Set");
    expect((within(row).getByRole("textbox", { name: "Quantity" }) as HTMLInputElement).value).toBe("4");
    expect(within(row).getByRole("combobox", { name: "Venue" }).textContent).toContain("Grand Hall");
    expect((within(row).getByRole("textbox", { name: "Technical requirements" }) as HTMLTextAreaElement).value).toBe("Two on stage");
  });

  it("Save sends the change to equipment-service, confirms it and refreshes the list", async () => {
    const fetchMock = mockServer(200, { id: "r1" });
    openChangeRow();

    fireEvent.change(screen.getByRole("textbox", { name: "Quantity" }), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Equipment request saved"));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/events\/evt-1\/equipment-requests\/r1$/);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ equipmentId: "eq-mic", quantity: "6", venueBookingId: "vb-hall", notes: "Two on stage" });
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole("form", { name: "Change equipment item" })).toBeNull();
  });

  it("SCRUM-88/AC2 says first that saving sends an Arranged item back to Technical Support as Submitted", () => {
    openChangeRow(aRequest({ status: "ARRANGED", statusLabel: "Arranged" }));
    expect(screen.getByRole("status").textContent).toContain("This request is Arranged. Saving a change sends it back to Technical Support Staff as Submitted");
  });
});

describe("SCRUM-136/AC3, AC6 the coordinator sees the status Technical Support set", () => {
  it("shows each item's status as a badge with an icon and its label, and why it cannot be fulfilled", () => {
    render(
      <EventEquipmentRequests
        data={data({
          requests: [
            aRequest({ status: "ARRANGED", statusLabel: "Arranged" }),
            aRequest({ id: "r2", equipment: "AV: Projector Unit", status: "CANNOT_FULFIL", statusLabel: "Cannot Fulfil", reason: "All units are in repair" }),
          ],
        })}
        form={form}
      />,
    );

    const [arranged, cannot] = screen.getAllByRole("row").slice(1);
    expect(within(arranged).getByText("Arranged").closest("[data-tone]")?.getAttribute("data-tone")).toBe("success");
    expect(within(arranged).getByTestId("status-icon")).toBeTruthy();
    expect(within(cannot).getByText("Cannot Fulfil").closest("[data-tone]")?.getAttribute("data-tone")).toBe("danger");
    expect(within(cannot).getByText("Reason: All units are in repair")).toBeTruthy();
  });
});

// Moved from the old request and change pages, which now open this tab (SCRUM-136).
describe("SCRUM-86/AC1, SCRUM-88/AC1 the row's starting choices", () => {
  const twoVenues: EquipmentRequestFormData = {
    ...form,
    venues: [...form.venues, { id: "vb-room", venueName: "Room 3.1", date: "2026-10-15", startTime: "09:00", endTime: "12:00" }],
  };

  it("SCRUM-86/AC1 with several approved venues, none is picked for the coordinator, who chooses one", () => {
    render(<EventEquipmentRequests data={data()} form={twoVenues} />);
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(screen.getByRole("combobox", { name: "Venue" }).textContent).toContain("Choose the venue");
  });

  it("SCRUM-86/AC1 says a venue must be booked first when the event has no approved venue", () => {
    render(<EventEquipmentRequests data={data()} form={{ ...form, venues: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(screen.getByRole("status").textContent).toContain("This event has no approved venue booking yet.");
  });

  it("SCRUM-88/AC1 an item or venue no longer offered starts unchosen, so the coordinator picks again", () => {
    render(<EventEquipmentRequests data={data({ requests: [aRequest({ equipmentId: "eq-retired", venueBookingId: "vb-gone" })] })} form={form} />);
    fireEvent.click(screen.getByRole("button", { name: "Change the Audio: Wireless Microphone Set request" }));
    expect(screen.getByRole("combobox", { name: "Equipment" }).textContent).toContain("Choose the equipment");
    expect(screen.getByRole("combobox", { name: "Venue" }).textContent).toContain("Choose the venue");
  });
});

describe("SCRUM-86/AC4, AC5 missing or wrong information in the row", () => {
  it("SCRUM-86/AC4 does not send, marks every empty field, and keeps what was typed", () => {
    const fetchMock = mockServer(201, {});
    render(<EventEquipmentRequests data={data()} form={{ ...form, venues: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));

    fireEvent.change(screen.getByRole("textbox", { name: "Technical requirements" }), { target: { value: "Keep me" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(fetchMock).not.toHaveBeenCalled();
    for (const [field, message] of [
      [screen.getByRole("combobox", { name: "Equipment" }), "Choose the equipment."],
      [screen.getByRole("textbox", { name: "Quantity" }), "Enter the quantity."],
      [screen.getByRole("combobox", { name: "Venue" }), "Choose the venue."],
    ] as const) {
      expect(field.getAttribute("aria-invalid")).toBe("true");
      expect(screen.getByText(message)).toBeTruthy();
    }
    expect((screen.getByRole("textbox", { name: "Technical requirements" }) as HTMLTextAreaElement).value).toBe("Keep me");
  });

  it.each(["0", "-1", "abc"])("SCRUM-86/AC5 %s: not sent, and the quantity message is shown", (value) => {
    const fetchMock = mockServer(201, {});
    openAddRow();

    fireEvent.change(screen.getByRole("textbox", { name: "Quantity" }), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Quantity must be a whole number of 1 or more")).toBeTruthy();
  });
});

describe("SCRUM-136/AC10 the row when saving fails", () => {
  const save = async () => {
    openAddRow();
    await choose("Equipment", "Audio: Wireless Microphone Set");
    fireEvent.change(screen.getByRole("textbox", { name: "Quantity" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  };

  it("says so when equipment-service can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await save();
    expect((await screen.findByRole("alert")).textContent).toBe("We couldn't reach the server. Please try again.");
  });

  it("falls back to a general message when the reply has none", async () => {
    mockServer(500, {});
    await save();
    expect((await screen.findByRole("alert")).textContent).toBe("We couldn't save the item. Please try again.");
  });
});
