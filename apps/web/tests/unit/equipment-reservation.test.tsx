import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EquipmentReservationForm } from "@/components/EquipmentReservationForm";
import { reserveEquipment } from "@/lib/equipmentReservation";

// ----------------------------------------------------------------------------
// Test setup: the events and equipment the form offers, and a helper to submit.
// ----------------------------------------------------------------------------

/** The events a Technical Support Staff member can reserve for (GET /reservable-events). */
const events = [
  {
    id: "evt-devops",
    name: "DevOps Summit",
    status: "approved",
    date: "2099-10-15",
    startTime: "09:00",
    endTime: "17:00",
    coordinatorName: "Dana Lim",
  },
];

/** The catalogue, shown as cards (GET /equipment). */
const equipment = [
  { id: "eq-projector", name: "Projector Unit", type: "AV", totalQuantity: 10, operationalStatus: "available" },
  { id: "eq-led", name: "LED Wall Panel", type: "AV", totalQuantity: 4, operationalStatus: "damaged" },
];

const submit = () => fireEvent.click(screen.getByRole("button", { name: "Reserve equipment" }));

/** Fills in a valid form: DevOps Summit (15 Oct 2099, 09:00 to 17:00), the Projector Unit card, quantity 4. */
function fillValid() {
  fireEvent.click(screen.getByRole("button", { name: /DevOps Summit/ }));
  fireEvent.click(screen.getByRole("button", { name: /Projector Unit/ }));
  fireEvent.change(screen.getByLabelText("Quantity required"), { target: { value: "4" } });
}

/** What equipment-service replies (201) when 4 Projector Units are reserved and 6 are still free. */
const confirmation = {
  id: "res-1",
  equipmentName: "Projector Unit",
  quantity: 4,
  date: "2099-10-15",
  startTime: "09:00",
  endTime: "17:00",
  availableAfter: 6,
};

// end of test setup

// ----------------------------------------------------------------------------
// SCRUM-19 equipment reservation form
// ----------------------------------------------------------------------------
describe("SCRUM-19 equipment reservation form", () => {
  // AC6: submitting without choosing any equipment prompts for it straight away, without asking the service.

  it("SCRUM-19/AC6: prompts to select the equipment when none is chosen, and does not ask the service", () => {
    const reserve = vi.fn();
    render(<EquipmentReservationForm events={events} equipment={equipment} reserve={reserve} />);

    submit();

    expect(screen.getByText("Please select the equipment.")).toBeTruthy();
    expect(reserve).not.toHaveBeenCalled();
  });
  // end of AC6 prompt

  // AC6: the equipment to choose from is shown as cards, one per catalogue item, so there is something to select.
  it("SCRUM-19/AC6: shows each piece of equipment as a card with its name", () => {
    render(<EquipmentReservationForm events={events} equipment={equipment} reserve={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Projector Unit/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /LED Wall Panel/ })).toBeTruthy();
    // we want to see the equipment names in the catalogue, so the user can select one
  });
  // end of equipment cards

  // AC6: clicking a card chooses that equipment, so the prompt to select it no longer appears.
  it("SCRUM-19/AC6: clicking a card selects it, and the prompt to select equipment no longer appears", () => {
    render(<EquipmentReservationForm events={events} equipment={equipment} reserve={vi.fn()} />);

    const card = screen.getByRole("button", { name: /Projector Unit/ });
    fireEvent.click(card);
    submit();

    expect(card.getAttribute("aria-pressed")).toBe("true");
    // we want the card to be clickable and show it is selected, so the user can see what they chose
    expect(screen.queryByText("Please select the equipment.")).toBeNull();
  });
  // end of selecting a card

  // Clicking the chosen card a second time takes the choice back, so the user can change their mind: the card no longer
  // shows as chosen, and submitting asks them to select the equipment again.
  it("SCRUM-19/AC6: clicking the selected card again unselects it", () => {
    const reserve = vi.fn();
    render(<EquipmentReservationForm events={events} equipment={equipment} reserve={reserve} />);

    const card = screen.getByRole("button", { name: /Projector Unit/ });
    fireEvent.click(card);
    fireEvent.click(card);
    submit();

    expect(card.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("Please select the equipment.")).toBeTruthy();
    expect(reserve).not.toHaveBeenCalled();
  });
  // end of unselecting a card

  // AC7: with equipment chosen but no quantity typed, the form prompts for the quantity without asking the service.
  it("SCRUM-19/AC7: prompts for the quantity when it is left empty, and does not ask the service", () => {
    const reserve = vi.fn();
    render(<EquipmentReservationForm events={events} equipment={equipment} reserve={reserve} />);

    fireEvent.click(screen.getByRole("button", { name: /Projector Unit/ }));
    submit();

    expect(screen.getByText("Please enter the quantity required.")).toBeTruthy();
    expect(reserve).not.toHaveBeenCalled();
    // we want the user to be prompted for the quantity, so they can enter it
  });
  // end of AC7 quantity prompt

  // AC8: with equipment and quantity filled in but no date or times, the form prompts for each one without asking the service.
  it("SCRUM-19/AC8: prompts for the date, start time and end time when they are left empty", () => {
    const reserve = vi.fn();
    render(<EquipmentReservationForm events={events} equipment={equipment} reserve={reserve} />);

    fireEvent.click(screen.getByRole("button", { name: /Projector Unit/ }));
    fireEvent.change(screen.getByLabelText("Quantity required"), { target: { value: "4" } });
    submit();

    expect(screen.getByText("Please enter a date.")).toBeTruthy();
    expect(screen.getByText("Please enter a start time.")).toBeTruthy();
    expect(screen.getByText("Please enter an end time.")).toBeTruthy();
    expect(reserve).not.toHaveBeenCalled();
    // ensures that the user is prompted for the date and times, so they can enter them
  });
  // end of AC8 period prompts

  // 19-S9: the equipment is reserved for an event, so submitting without choosing one prompts for it.
  it("SCRUM-19/19-S9: prompts to select the event when none is chosen, and does not ask the service", () => {
    const reserve = vi.fn();
    render(<EquipmentReservationForm events={events} equipment={equipment} reserve={reserve} />);

    submit();

    expect(screen.getByText("Please select the event.")).toBeTruthy();
    expect(reserve).not.toHaveBeenCalled();
  });
  // end of event prompt

  // AC8: choosing an event fills in its date and times, so the user only changes them if the equipment is needed for less.
  it("SCRUM-19/AC8: choosing an event fills in the date, start time and end time from that event", () => {
    // we want to automatically fill in the event start time and end time and date 
    render(<EquipmentReservationForm events={events} equipment={equipment} reserve={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /DevOps Summit/ }));

    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("2099-10-15");
    expect((screen.getByLabelText("Start time") as HTMLInputElement).value).toBe("09:00");
    expect((screen.getByLabelText("End time") as HTMLInputElement).value).toBe("17:00");
  });
  // end of event pre-fill

  // AC8: everything is filled in, but the period makes no sense (the end is before the start), so the form says so.
  // we previously did something like this on the backend, like sending a postman query where the end time is before the start time and we reject. now, we are doing the same, but for the frontend
  it("SCRUM-19/AC8: prompts when the end time is not after the start time, and does not ask the service", () => {
    const reserve = vi.fn();
    render(<EquipmentReservationForm events={events} equipment={equipment} reserve={reserve} />);

    fireEvent.click(screen.getByRole("button", { name: /DevOps Summit/ })); // fills 09:00 to 17:00
    fireEvent.click(screen.getByRole("button", { name: /Projector Unit/ }));
    fireEvent.change(screen.getByLabelText("Quantity required"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "08:00" } });
    submit();

    expect(screen.getByText("The end time must be after the start time.")).toBeTruthy();
    expect(reserve).not.toHaveBeenCalled();
  });
  // end of period timing prompt

  // AC1: a valid form hands the chosen event, equipment, quantity and period to the service, exactly as typed.
  // checks that when everything is filled correctly, the frontend sends the correct data to the backend for reservation
  it("SCRUM-19/AC1: a valid form asks the service to reserve the chosen equipment for the event and period", async () => {
    const reserve = vi.fn().mockResolvedValue({ ok: true, data: {} });
    render(<EquipmentReservationForm events={events} equipment={equipment} reserve={reserve} />);

    fireEvent.click(screen.getByRole("button", { name: /DevOps Summit/ })); // fills 15 Oct 2099, 09:00 to 17:00
    fireEvent.click(screen.getByRole("button", { name: /Projector Unit/ }));
    fireEvent.change(screen.getByLabelText("Quantity required"), { target: { value: "4" } });
    submit();

    await waitFor(() => expect(reserve).toHaveBeenCalledTimes(1));
    expect(reserve).toHaveBeenCalledWith({
      eventId: "evt-devops",
      equipmentId: "eq-projector",
      quantity: "4",
      date: "2099-10-15",
      startTime: "09:00",
      endTime: "17:00",
    });
  });
  // end of sending the reservation

  // AC2 + AC3: after a successful reservation the form confirms what was reserved, and how many are still free.

  // Two different replies, so the form has to show what the service said and cannot just print fixed words.
  it.each([
    [confirmation, "Projector Unit: 4 reserved, on 2099-10-15, 09:00 to 17:00.", "6 still available for that period."],
    [
      { ...confirmation, equipmentName: "Wireless Microphone", quantity: 2, startTime: "10:00", endTime: "12:00", availableAfter: 8 },
      "Wireless Microphone: 2 reserved, on 2099-10-15, 10:00 to 12:00.",
      "8 still available for that period.",
    ],
  ])("SCRUM-19/AC2,AC3: confirms the reservation and shows how many are still available (%#)", async (reply, line, left) => {
    const reserve = vi.fn().mockResolvedValue({ ok: true, data: reply });
    render(<EquipmentReservationForm events={events} equipment={equipment} reserve={reserve} />);

    fillValid();
    submit();

    expect(await screen.findByText("Reserved")).toBeTruthy();
    expect(screen.getByText(line)).toBeTruthy();
    expect(screen.getByText(left)).toBeTruthy();
  });
  // end of confirmation

  // AC4 + AC5: when the service refuses because not enough is free, the form shows its message and confirms nothing.

  // Two different replies, so the form has to show what the service said and cannot just print fixed words.
  it.each([
    "Only 6 available for that period, but you asked for 8.",
    "Only 0 available for that period, but you asked for 1.",
  ])("SCRUM-19/AC4,AC5: shows the service's 'not enough' message and does not confirm a reservation (%#)", async (message) => {
    const reserve = vi.fn().mockResolvedValue({ ok: false, data: { code: "INSUFFICIENT", error: message } });
    render(<EquipmentReservationForm events={events} equipment={equipment} reserve={reserve} />);

    fillValid();
    submit();

    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(screen.queryByText("Reserved")).toBeNull();
  });
  // end of not enough

  // AC6: with a long catalogue, typing in the search box narrows the cards to the ones whose name matches.
  
  it("SCRUM-19/AC6: the search box narrows the equipment cards to names that match, ignoring capital letters", () => {
    render(<EquipmentReservationForm events={events} equipment={equipment} reserve={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Search equipment"), { target: { value: "led wall" } });

    expect(screen.getByRole("button", { name: /LED Wall Panel/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Projector Unit/ })).toBeNull();
  });
  // end of equipment search

  // 19-S10: damaged, under maintenance and retired equipment cannot be reserved, so its card is greyed out and cannot be chosen.
  it("SCRUM-19/19-S10: a card for equipment that is not usable is disabled and cannot be chosen", () => {
    render(<EquipmentReservationForm events={events} equipment={equipment} reserve={vi.fn()} />);

    const damaged = screen.getByRole("button", { name: /LED Wall Panel/ }) as HTMLButtonElement; // status: damaged
    fireEvent.click(damaged);

    expect(damaged.disabled).toBe(true);
    expect(damaged.getAttribute("aria-pressed")).toBe("false");
    expect((screen.getByRole("button", { name: /Projector Unit/ }) as HTMLButtonElement).disabled).toBe(false);
  });
  // end of unusable cards

  // AC1: when the page is used for real, nothing fake is plugged in, so pressing the button should contact the real
  // equipment service. Here nothing is really sent: we only check that it tried the right address.
  // the form above uses a pretend service. the below codes test in the event where we use the real service, we want to check that the form is sending the correct data to the real service. we are not testing the service itself, just that the form is sending the correct data to the service
  it("SCRUM-19/AC1: without a `reserve` given, the form uses the real call to equipment-service", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => confirmation });
    vi.stubGlobal("fetch", fetchMock);
    render(<EquipmentReservationForm events={events} equipment={equipment} />);

    fillValid();
    submit();

    expect(await screen.findByText("Reserved")).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:4004/equipment-reservations");
    vi.unstubAllGlobals();
  });
  // end of the real call
});
// end of SCRUM-19 equipment reservation form

// ----------------------------------------------------------------------------
// SCRUM-19 the browser's call to equipment-service (the form tests above use a pretend service instead)
// ----------------------------------------------------------------------------
describe("SCRUM-19 reserveEquipment", () => {
  afterEach(() => vi.unstubAllGlobals());

  const request = {
    eventId: "evt-devops",
    equipmentId: "eq-projector",
    quantity: "4",
    date: "2099-10-15",
    startTime: "09:00",
    endTime: "17:00",
  };

  // AC1: the six fields are sent in the body of a POST to /equipment-reservations, with the login cookie.
  // This makes sure the function can transport the right info: it only carries the reservation to the service.
  it("SCRUM-19/AC1: POSTs the reservation to equipment-service as JSON, sending the login cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => confirmation });
    vi.stubGlobal("fetch", fetchMock);

    expect(await reserveEquipment(request)).toEqual({ ok: true, data: confirmation });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4004/equipment-reservations");
    expect(options).toEqual({
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  });
  // end of the POST

  // If equipment-service cannot be reached at all, the user gets a plain message instead of a crash.
  it("SCRUM-19: gives a friendly message when equipment-service cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    expect(await reserveEquipment(request)).toEqual({
      ok: false,
      data: { error: "We couldn't reach the server. Please try again." },
    });
  });
  // end of unreachable
});
// end of SCRUM-19 reserveEquipment

// ----------------------------------------------------------------------------
// SCRUM-138: the redesigned reservation page
// ----------------------------------------------------------------------------
describe("SCRUM-138 equipment reservation redesign", () => {
  it("SCRUM-138/AC1 the item's free count drops straight after a reservation, with a confirmation", async () => {
    const reserve = vi.fn().mockResolvedValue({ ok: true, data: confirmation });
    render(<EquipmentReservationForm events={events} equipment={equipment} reserve={reserve} />);
    expect(screen.getByText("10 in total")).toBeTruthy();

    fillValid();
    submit();

    expect(await screen.findByText("6 of 10")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Projector Unit: 4 reserved");
  });

  it("SCRUM-138/AC1 a refused reservation leaves the count alone", async () => {
    const reserve = vi.fn().mockResolvedValue({ ok: false, data: { code: "INSUFFICIENT", error: "Only 6 available for that period, but you asked for 8." } });
    render(<EquipmentReservationForm events={events} equipment={equipment} reserve={reserve} />);

    fillValid();
    submit();

    expect((await screen.findByRole("alert")).textContent).toContain("Only 6 available");
    expect(screen.queryByText(/\d+ of 10/)).toBeNull();
  });

  it("SCRUM-138/AC2 the confirmation links to the Inventory for the reserved period", async () => {
    const reserve = vi.fn().mockResolvedValue({ ok: true, data: confirmation });
    render(<EquipmentReservationForm events={events} equipment={equipment} reserve={reserve} />);

    fillValid();
    submit();

    const link = await screen.findByRole("link", { name: /Inventory/ });
    expect(link.getAttribute("href")).toBe("/equipment-inventory?date=2099-10-15&startTime=09%3A00&endTime=17%3A00");
  });

  it("SCRUM-138/AC5 each item's status is a badge with an icon and a label", () => {
    render(<EquipmentReservationForm events={events} equipment={equipment} />);

    expect(screen.getByText("Available")).toBeTruthy();
    expect(screen.getByText("Damaged")).toBeTruthy();
    expect(screen.getAllByTestId("status-icon").length).toBeGreaterThanOrEqual(2);
  });

  it("SCRUM-138/AC9 shows an empty state when there is nothing to reserve", () => {
    render(<EquipmentReservationForm events={[]} equipment={[]} />);

    expect(screen.getByText("Nothing to reserve yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reserve equipment" })).toBeNull();
  });
});
