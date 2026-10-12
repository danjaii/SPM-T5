import { utcToSgt } from "@spm-t5/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EquipmentAvailabilityForm } from "@/components/EquipmentAvailabilityForm";
import { checkEquipmentAvailability, type AvailabilityResultView } from "@/lib/equipmentAvailability";

// ----------------------------------------------------------------------------
// Test setup: the catalogue the form suggests, a pretend service reply, and helpers to fill in and submit.
// ----------------------------------------------------------------------------

const equipment = [
  { id: "eq-projector", name: "Projector Unit", operationalStatus: "available" },
  { id: "eq-led", name: "LED Wall Panel", operationalStatus: "damaged" },
];

/** What equipment-service replies for 4 Projector Units with 6 available, unless a test changes part of it. */
const reply = (changes: Partial<AvailabilityResultView> = {}): AvailabilityResultView => ({
  equipmentId: "eq-projector",
  equipmentName: "Projector Unit",
  operationalStatus: "available",
  totalQuantity: 10,
  requestedQuantity: 4,
  availableQuantity: 6,
  sufficient: true,
  shortfall: 0,
  date: "2099-10-15",
  startTime: "09:00",
  endTime: "17:00",
  ...changes,
});

/** Types into the five boxes: 4 Projector Units on 15 Oct 2099 (a future date), 09:00 to 17:00, unless changed. */
function fill(changes: Partial<Record<"name" | "quantity" | "date" | "start" | "end", string>> = {}) {
  const v = { name: "Projector Unit", quantity: "4", date: "2099-10-15", start: "09:00", end: "17:00", ...changes };
  fireEvent.change(screen.getByLabelText("Equipment name"), { target: { value: v.name } });
  fireEvent.change(screen.getByLabelText("Quantity required"), { target: { value: v.quantity } });
  fireEvent.change(screen.getByLabelText("Date"), { target: { value: v.date } });
  fireEvent.change(screen.getByLabelText("Start time"), { target: { value: v.start } });
  fireEvent.change(screen.getByLabelText("End time"), { target: { value: v.end } });
}

const submit = () => fireEvent.click(screen.getByRole("button", { name: "Check availability" }));

// end of test setup

// ----------------------------------------------------------------------------
// SCRUM-18 equipment availability form
// ----------------------------------------------------------------------------
describe("SCRUM-18 equipment availability form", () => {
  // Name suggestions (18-S11): the catalogue names are offered as the user types.
  it("offers the catalogue names as suggestions for the equipment name", () => {
    render(<EquipmentAvailabilityForm equipment={equipment} check={vi.fn()} />);

    const suggestions = [...document.querySelectorAll("datalist#equipment-names option")].map((o) => o.getAttribute("value"));
    expect(suggestions).toEqual(["Projector Unit", "LED Wall Panel"]);
  });
  // end of name suggestions

  // Default times: the form starts at 7:00 AM to 11:00 PM, so the time pickers open on whole hours.
  it("starts with a start time of 07:00 and an end time of 23:00, and an empty date", () => {
    render(<EquipmentAvailabilityForm equipment={equipment} check={vi.fn()} />);

    expect((screen.getByLabelText("Start time") as HTMLInputElement).value).toBe("07:00");
    expect((screen.getByLabelText("End time") as HTMLInputElement).value).toBe("23:00");
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("");
  });
  // end of default times

  // AC7 in the calendar: days before today (Singapore time) are greyed out, so a past date cannot be picked.
  it("SCRUM-18/AC7: the calendar does not offer dates before today", () => {
    render(<EquipmentAvailabilityForm equipment={equipment} check={vi.fn()} />);

    const today = utcToSgt(new Date()).date; // e.g. "2026-10-06"
    expect(screen.getByLabelText("Date").getAttribute("min")).toBe(today);
  });
  // end of calendar minimum

  // AC1 + AC2: shows the available quantity, and says it is available.
  it("SCRUM-18/AC1,AC2: shows how many are available and says Available", async () => {
    const check = vi.fn().mockResolvedValue({ ok: true, data: reply() });
    render(<EquipmentAvailabilityForm equipment={equipment} check={check} />);

    fill();
    submit();

    expect(await screen.findByText("Available")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Projector Unit: 6 available, on 2099-10-15, 09:00 to 17:00.");
    // Only what is free matters to the user, not the total owned.
    expect(screen.getByRole("status").textContent).not.toContain("of 10");
    // The user typed the quantity themselves, so the result does not repeat it.
    expect(screen.getByRole("status").textContent).not.toContain("requested");
  });
  // end of AC1, AC2

  // AC3: says it is insufficient, and by how much.
  it("SCRUM-18/AC3: says Insufficient and shows the shortfall", async () => {
    const check = vi.fn().mockResolvedValue({ ok: true, data: reply({ requestedQuantity: 8, sufficient: false, shortfall: 2 }) });
    render(<EquipmentAvailabilityForm equipment={equipment} check={check} />);

    fill({ quantity: "8" });
    submit();

    expect(await screen.findByText("Insufficient")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Short by 2");
  });
  // end of AC3

  // Unusable equipment (18-S10): explains why nothing is available.
  it("explains why damaged equipment has nothing available", async () => {
    const check = vi.fn().mockResolvedValue({
      ok: true,
      data: reply({ equipmentName: "LED Wall Panel", operationalStatus: "damaged", availableQuantity: 0, sufficient: false, shortfall: 4 }),
    });
    render(<EquipmentAvailabilityForm equipment={equipment} check={check} />);

    fill({ name: "LED Wall Panel" });
    submit();

    await screen.findByText("Insufficient");
    expect(screen.getByRole("status").textContent).toContain("This equipment is damaged, so none can be used.");
  });
  // end of unusable equipment

  // AC4 + AC6: prompts straight away, without asking the service.
  it("SCRUM-18/AC4,AC6: prompts for a missing name, date and times without asking the service", () => {
    const check = vi.fn();
    render(<EquipmentAvailabilityForm equipment={equipment} check={check} />);

    fill({ name: "", date: "", start: "", end: "" });
    submit();

    expect(screen.getByText("Please enter the equipment name.")).toBeTruthy();
    expect(screen.getByText("Please enter a date.")).toBeTruthy();
    expect(screen.getByText("Please enter a start time.")).toBeTruthy();
    expect(screen.getByText("Please enter an end time.")).toBeTruthy();
    expect(check).not.toHaveBeenCalled();
  });
  // end of AC4, AC6

  // AC7: a period in the past is refused straight away.
  it("SCRUM-18/AC7: refuses a date in the past without asking the service", () => {
    const check = vi.fn();
    render(<EquipmentAvailabilityForm equipment={equipment} check={check} />);

    fill({ date: "2000-01-01" });
    submit();

    expect(screen.getByText("The date and time must not be in the past.")).toBeTruthy();
    expect(check).not.toHaveBeenCalled();
  });
  // end of AC7

  // AC5: the service says the name is unknown; the form shows it under the name box.
  it("SCRUM-18/AC5: shows the service's 'does not match any equipment' message under the name", async () => {
    const check = vi.fn().mockResolvedValue({
      ok: false,
      data: { error: "Some fields are invalid.", fieldErrors: { equipmentName: "“Hologram” does not match any equipment in the catalogue." } },
    });
    render(<EquipmentAvailabilityForm equipment={equipment} check={check} />);

    fill({ name: "Hologram" });
    submit();

    expect(await screen.findByText("“Hologram” does not match any equipment in the catalogue.")).toBeTruthy();
  });
  // end of AC5

  // A failure the form cannot pin on one box (e.g. not allowed): shown at the top, and any old result is cleared.
  it("shows a general error, and clears the previous result, when the check fails for another reason", async () => {
    const check = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: reply() })
      .mockResolvedValueOnce({ ok: false, data: { error: "You are not allowed to do that." } });
    render(<EquipmentAvailabilityForm equipment={equipment} check={check} />);

    fill();
    submit();
    await screen.findByText("Available");

    submit();
    expect(await screen.findByText("You are not allowed to do that.")).toBeTruthy();
    expect(screen.queryByText("Available")).toBeNull();
  });
  // end of general error
});
// end of SCRUM-18 equipment availability form

// ----------------------------------------------------------------------------
// SCRUM-18 the browser's call to equipment-service (the form tests above use a pretend service instead)
// ----------------------------------------------------------------------------
describe("SCRUM-18 checkEquipmentAvailability", () => {
  afterEach(() => vi.unstubAllGlobals());

  const question = { equipmentName: "Projector Unit", quantity: "4", date: "2099-10-15", startTime: "09:00", endTime: "17:00" };

  it("asks equipment-service with the five fields in the web address, sending the login cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => reply() });
    vi.stubGlobal("fetch", fetchMock);

    expect(await checkEquipmentAvailability(question)).toEqual({ ok: true, data: reply() });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "http://localhost:4004/equipment-availability?equipmentName=Projector+Unit&quantity=4&date=2099-10-15&startTime=09%3A00&endTime=17%3A00",
    );
    expect(options).toEqual({ credentials: "include", cache: "no-store" });
  });

  it("gives a friendly message when equipment-service cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    expect(await checkEquipmentAvailability(question)).toEqual({
      ok: false,
      data: { error: "We couldn't reach the server. Please try again." },
    });
  });
});
// end of SCRUM-18 checkEquipmentAvailability
