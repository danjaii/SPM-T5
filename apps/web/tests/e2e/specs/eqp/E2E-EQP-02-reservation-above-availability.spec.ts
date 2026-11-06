import { EquipmentAvailabilityPage, EquipmentReservationPage } from "../../pages/EquipmentPages";
import { sgt } from "../../fixtures/data";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-19/AC4, AC5 (failure path): asking for more units than are free is rejected, the message gives the shortfall, nothing
// is saved, and the availability for that period is unchanged.
const t = tc("E2E-EQP-02");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const item = await data.equipment({ totalQuantity: 10 });
  const event = await data.event({ day: DAY, start: "09:00", end: "17:00" });
  // Technical Support only sees an event with technical work, and 4 of the 10 units are already reserved for the day
  await data.equipmentRequest({ event, equipment: await data.equipment({ label: "Other item" }), day: DAY, start: "09:00", end: "17:00" });
  await data.insert("equipment_reservations", {
    event_id: event.id, equipment_id: item.id, quantity_requested: 4, quantity_reserved: 4, status: "reserved",
    start_datetime: sgt(DAY, "09:00"), end_datetime: sgt(DAY, "17:00"),
  });

  const tech = await as("tech");
  const reservation = new EquipmentReservationPage(tech);
  const availability = new EquipmentAvailabilityPage(tech);
  const period = { date: DAY, start: "10:00", end: "12:00" };

  await test.step("asking for 8 when 6 are free is refused and says how many are free (19-S4)", async () => {
    await reservation.open();
    await reservation.reserve({ eventName: event.name, equipmentName: item.name, quantity: 8, ...period });
    const refusal = tech.getByRole("main").getByRole("alert");
    await expect(refusal).toContainText("Only 6 available for that period, but you asked for 8.");
    await expect(reservation.confirmation, "nothing was confirmed").toHaveCount(0);
  });

  await test.step("nothing was saved and the availability is unchanged (19-S5)", async () => {
    expect(await data.reservationsOf(item)).toEqual([{ status: "reserved", quantity_reserved: 4 }]);
    const result = await availability.check(item.name, 1, period);
    await availability.expectAvailable(result, item.name, 6);
  });
});
