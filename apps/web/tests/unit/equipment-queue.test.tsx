import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

import { EquipmentQueueList } from "@/components/EquipmentQueueList";

import type { EquipmentQueueItemView } from "@/lib/equipmentRequests";
import { groupQueueByEvent } from "@/lib/equipmentQueue";

// SCRUM-136: the Technical Support queue (Figma frame 11), the waiting requests grouped by event.

const anItem = (over: Partial<EquipmentQueueItemView> = {}): EquipmentQueueItemView => ({
  id: "r1",
  eventId: "evt-1",
  eventName: "Tech Summit",
  eventDate: "2026-11-14",
  venueName: "Grand Hall",
  equipment: "Audio: Wireless Microphone Set",
  quantity: 4,
  status: "SUBMITTED",
  statusLabel: "Submitted",
  updated: false,
  ...over,
});

describe("SCRUM-136/AC2 pending requests grouped by event, in queue order", () => {
  it("keeps equipment-service's order: soonest event first, and each event's requests oldest first", () => {
    const groups = groupQueueByEvent([
      anItem({ id: "r1" }),
      anItem({ id: "r2", eventId: "evt-2", eventName: "Pitch Day", eventDate: "2026-12-05" }),
      anItem({ id: "r3" }),
    ]);

    expect(groups.map((g) => [g.eventId, g.eventName, g.eventDate, g.items.map((i) => i.id)])).toEqual([
      ["evt-1", "Tech Summit", "2026-11-14", ["r1", "r3"]],
      ["evt-2", "Pitch Day", "2026-12-05", ["r2"]],
    ]);
  });
});

describe("SCRUM-136/AC2 one card per event", () => {
  const queue = [
    anItem({ id: "r1" }),
    anItem({ id: "r2", eventId: "evt-2", eventName: "Pitch Day", eventDate: "2026-12-05" }),
    anItem({ id: "r3" }),
  ];
  const cards = () => within(screen.getByRole("navigation", { name: "Events with waiting requests" })).getAllByRole("link");

  it("lists each event with its date and how many items wait, linking to it, the first one open", () => {
    render(<EquipmentQueueList requests={queue} />);

    expect(cards().map((c) => [c.textContent, c.getAttribute("href")])).toEqual([
      [expect.stringMatching(/Tech Summit.*2026-11-14.*2 items/), "/equipment-requests?event=evt-1"],
      [expect.stringMatching(/Pitch Day.*2026-12-05.*1 item$/), "/equipment-requests?event=evt-2"],
    ]);
    expect(cards()[0].getAttribute("aria-current")).toBe("true");
    expect(cards()[1].getAttribute("aria-current")).toBeNull();
  });

  it("opens the event named in the address", () => {
    render(<EquipmentQueueList requests={queue} selectedEventId="evt-2" />);
    expect(cards()[1].getAttribute("aria-current")).toBe("true");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockClear();
});

describe("SCRUM-136/AC2, AC6 the chosen event's items", () => {
  const queue = [
    anItem({ id: "r1", updated: true }),
    anItem({ id: "r2", eventId: "evt-2", eventName: "Pitch Day", eventDate: "2026-12-05" }),
    anItem({ id: "r3", equipment: "AV: Projector Unit", quantity: 2, venueName: null, status: "UNDER_REVIEW", statusLabel: "Under Review" }),
  ];
  const panel = () => screen.getByRole("region", { name: "Tech Summit" });

  it("lists the open event's items with how many are needed, the venue and the status, linking to each request", () => {
    render(<EquipmentQueueList requests={queue} />);

    const rows = within(panel()).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell").slice(0, 3).map((c) => c.textContent))).toEqual([
      ["Audio: Wireless Microphone Set", "4", "Grand Hall"],
      ["AV: Projector Unit", "2", "No venue"],
    ]);
    expect(within(rows[0]).getByRole("link", { name: "Audio: Wireless Microphone Set" }).getAttribute("href")).toBe("/equipment-requests/r1");
    expect(within(panel()).queryByText("Pitch Day")).toBeNull();
  });

  it("shows each status as a badge with an icon and a label, and marks a request the coordinator changed as Updated", () => {
    render(<EquipmentQueueList requests={queue} />);

    const [first, second] = within(panel()).getAllByRole("row").slice(1);
    expect(within(first).getByText("Submitted").closest("[data-tone]")?.getAttribute("data-tone")).toBe("info");
    expect(within(first).getByText("Updated")).toBeTruthy();
    expect(within(second).getByText("Under Review")).toBeTruthy();
    expect(within(second).queryByText("Updated")).toBeNull();
    expect(within(panel()).getAllByTestId("status-icon").length).toBeGreaterThanOrEqual(3);
  });
});

describe("SCRUM-136/AC2 update an item's status from the queue", () => {
  it("Update status opens the status form for that item; saving closes it and refreshes the queue", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<EquipmentQueueList requests={[anItem()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Update the status of Audio: Wireless Microphone Set" }));
    const dialog = await screen.findByRole("dialog", { name: "Update status: Audio: Wireless Microphone Set" });
    fireEvent.click(within(dialog).getByRole("combobox", { name: "New status" }));
    const option = await screen.findByRole("option", { name: "Arranged" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    fireEvent.pointerDown(option);
    fireEvent.mouseDown(option);
    fireEvent.pointerUp(option);
    fireEvent.mouseUp(option);
    fireEvent.click(option);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save status" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ status: "ARRANGED", reason: "" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("SCRUM-136/AC10 an empty queue", () => {
  it("shows a designed empty state with the spec's message", () => {
    render(<EquipmentQueueList requests={[]} />);
    expect(screen.getByText("No requests waiting for action")).toBeTruthy();
    expect(screen.getByText("New requests from coordinators will show up here, soonest event first.")).toBeTruthy();
  });
});
