import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Pretend loader (tested in get-reservation-form-data.test.ts), so this test is only about the page itself
const { getReservationFormData } = vi.hoisted(() => ({ getReservationFormData: vi.fn() }));
vi.mock("@/lib/equipmentReservationServer", () => ({ getReservationFormData }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ replace: vi.fn() }) }));

import EquipmentReservationPage from "@/app/equipment-reservation/page";

// ---------------------------------------------------------------------------
// SCRUM-19: Equipment reservation page route (/equipment-reservation)
// ---------------------------------------------------------------------------
describe("SCRUM-19 equipment reservation page (/equipment-reservation)", () => {
  // We already tested that the list of events (the events equipment can be reserved for) and the list of equipment (the items to choose from) can be fetched, and that the form can display them. This test checks the two work together: the page fetches both lists, then passes them on to the form so they are displayed.
  
  it("shows the reservation form with the events and equipment that were loaded", async () => {
    getReservationFormData.mockResolvedValue({
      events: [{ id: "evt-devops", name: "DevOps Summit", status: "approved", date: "2099-10-15", startTime: "09:00", endTime: "17:00", coordinatorName: "Dana Lim" }],
      equipment: [{ id: "eq-projector", name: "Projector Unit", type: "AV", totalQuantity: 10, operationalStatus: "available" }],
    });

    render(await EquipmentReservationPage());

    expect(screen.getByRole("heading", { name: "Reserve equipment" })).toBeTruthy();
    expect(screen.getByRole("option", { name: /DevOps Summit/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Projector Unit/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /back to dashboard/i }).getAttribute("href")).toBe("/dashboard");
  });
  // end of showing the form

  // Someone who is not a technical support staff member should not see a crash screen: the page tells them they are not allowed to reserve equipment, and the equipment list and form do not appear for them.
  it("shows the message instead of the form when the lists could not be loaded", async () => {
    getReservationFormData.mockResolvedValue({ error: "Only technical support staff can reserve equipment." });

    render(await EquipmentReservationPage());

    expect(screen.getByRole("alert").textContent).toBe("Only technical support staff can reserve equipment.");
    expect(screen.queryByRole("button", { name: "Reserve equipment" })).toBeNull();
  });
  // end of showing the message
});
// end of SCRUM-19 equipment reservation page
