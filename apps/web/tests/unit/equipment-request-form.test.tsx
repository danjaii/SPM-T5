import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

import { EquipmentRequestForm } from "@/components/EquipmentRequestForm";
import type { EquipmentRequestFormData } from "@/lib/equipmentRequests";

const formData = (over: Partial<EquipmentRequestFormData> = {}): EquipmentRequestFormData => ({
  event: { id: "evt-1", name: "Tech Summit" },
  equipment: [
    { id: "eq-mic", label: "Audio: Wireless Microphone Set" },
    { id: "eq-projector", label: "AV: Projector Unit" },
  ],
  venues: [{ id: "vb-hall", venueName: "Grand Hall", date: "2026-10-15", startTime: "09:00", endTime: "17:00" }],
  ...over,
});

function mockServer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const equipment = () => screen.getByLabelText("Equipment") as HTMLSelectElement;
const quantity = () => screen.getByLabelText("Quantity") as HTMLInputElement;
const venue = () => screen.getByLabelText("Venue") as HTMLSelectElement;
const notes = () => screen.getByLabelText("Technical notes (optional)") as HTMLTextAreaElement;
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Submit request" }));

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-86/AC1 create a request", () => {
  it("lists the items under their type, and picks the only approved venue already", () => {
    render(<EquipmentRequestForm form={formData()} />);

    expect([...equipment().options].map((o) => o.text)).toEqual([
      "Choose the equipment",
      "Audio: Wireless Microphone Set",
      "AV: Projector Unit",
    ]);
    expect(venue().value).toBe("vb-hall");
    expect(screen.getByRole("option", { name: "Grand Hall (2026-10-15, 09:00–17:00)" })).toBeTruthy();
  });

  it("sends the request to equipment-service and returns to the event, where it is listed", async () => {
    const fetchMock = mockServer(201, { id: "req-1" });
    render(<EquipmentRequestForm form={formData()} />);

    fireEvent.change(equipment(), { target: { value: "eq-mic" } });
    fireEvent.change(quantity(), { target: { value: "4" } });
    fireEvent.change(notes(), { target: { value: "Two on stage" } });
    submit();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/events/evt-1"));
    expect(refresh).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4004/events/evt-1/equipment-requests",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      equipmentId: "eq-mic",
      quantity: "4",
      venueBookingId: "vb-hall",
      notes: "Two on stage",
    });
  });

  it("with several approved venues, none is picked for the coordinator, who chooses one", async () => {
    const second = { id: "vb-annex", venueName: "Annex", date: "2026-10-16", startTime: "09:00", endTime: "12:00" };
    const fetchMock = mockServer(201, { id: "req-1" });
    render(<EquipmentRequestForm form={formData({ venues: [formData().venues[0], second] })} />);
    expect(venue().value).toBe("");

    fireEvent.change(equipment(), { target: { value: "eq-mic" } });
    fireEvent.change(quantity(), { target: { value: "1" } });
    fireEvent.change(venue(), { target: { value: "vb-annex" } });
    submit();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).venueBookingId).toBe("vb-annex");
  });

  it("says a venue must be booked first when the event has no approved venue", () => {
    render(<EquipmentRequestForm form={formData({ venues: [] })} />);
    expect(screen.getByRole("status").textContent).toMatch(/no approved venue booking yet/);
  });
});

describe("SCRUM-86/AC4 missing information", () => {
  it("does not send, highlights every empty field, and keeps what was typed", () => {
    const fetchMock = mockServer(201, {});
    render(<EquipmentRequestForm form={formData({ venues: [] })} />);

    fireEvent.change(notes(), { target: { value: "Keep me" } });
    submit();

    expect(fetchMock).not.toHaveBeenCalled();
    for (const [field, message] of [
      [equipment(), "Choose the equipment."],
      [quantity(), "Enter the quantity."],
      [venue(), "Choose the venue."],
    ] as const) {
      expect(field.getAttribute("aria-invalid")).toBe("true");
      expect(field.closest(".field")!.className).toContain("field--error");
      expect(screen.getByText(message)).toBeTruthy();
    }
    expect(notes().value).toBe("Keep me");
  });
});

describe("SCRUM-86/AC5 wrong quantity", () => {
  it.each(["0", "-1", "1.5", "abc"])("%s: not sent, the message is shown, and the value is kept", (value) => {
    const fetchMock = mockServer(201, {});
    render(<EquipmentRequestForm form={formData()} />);

    fireEvent.change(equipment(), { target: { value: "eq-mic" } });
    fireEvent.change(quantity(), { target: { value } });
    submit();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Quantity must be a whole number of 1 or more")).toBeTruthy();
    expect(quantity().value).toBe(value);
    expect(equipment().value).toBe("eq-mic");
  });
});

describe("SCRUM-86 equipment-service refuses", () => {
  it("shows its field messages and its error, and keeps what was typed", async () => {
    mockServer(422, { code: "VALIDATION_FAILED", error: "Some fields are invalid.", fieldErrors: { equipmentId: "Choose the equipment." } });
    render(<EquipmentRequestForm form={formData()} />);

    fireEvent.change(equipment(), { target: { value: "eq-mic" } });
    fireEvent.change(quantity(), { target: { value: "2" } });
    submit();

    expect((await screen.findByRole("alert")).textContent).toBe("Some fields are invalid.");
    expect(screen.getByText("Choose the equipment.")).toBeTruthy();
    expect(quantity().value).toBe("2");
    expect(push).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Submit request" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("SCRUM-86/AC6 shows the finished-event refusal if the event closed while the form was open", async () => {
    mockServer(409, { code: "EVENT_LOCKED", error: "Equipment can't be requested for a completed, cancelled or rejected event." });
    render(<EquipmentRequestForm form={formData()} />);

    fireEvent.change(equipment(), { target: { value: "eq-mic" } });
    fireEvent.change(quantity(), { target: { value: "2" } });
    submit();

    expect((await screen.findByRole("alert")).textContent).toMatch(/completed, cancelled or rejected/);
  });

  it("says so when equipment-service can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<EquipmentRequestForm form={formData()} />);

    fireEvent.change(equipment(), { target: { value: "eq-mic" } });
    fireEvent.change(quantity(), { target: { value: "2" } });
    submit();

    expect((await screen.findByRole("alert")).textContent).toBe("We couldn't reach the server. Please try again.");
  });

  it("falls back to a general message when the reply has none", async () => {
    mockServer(500, {});
    render(<EquipmentRequestForm form={formData()} />);

    fireEvent.change(equipment(), { target: { value: "eq-mic" } });
    fireEvent.change(quantity(), { target: { value: "2" } });
    submit();

    expect((await screen.findByRole("alert")).textContent).toBe("We couldn't submit the request. Please try again.");
  });
});
