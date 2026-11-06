import { EquipmentAvailabilityPage, EquipmentReservationPage } from "../../pages/EquipmentPages";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-18 / SCRUM-19: a reservation lowers the units free for any period that overlaps it. Availability is the PEAK
// reserved at one moment in the period, not the sum of every reservation inside it (19-S11), and a period that starts
// exactly when a reservation ends does not overlap it (18-S9).
const t = tc("E2E-EQP-01");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const item = await data.equipment({ totalQuantity: 10 });
  const event = await data.event({ day: DAY, start: "09:00", end: "17:00" });
  // Technical Support can only see an event that has technical work. A plain request for another item gives it that, and does
  // not count against this item's availability.
  await data.equipmentRequest({ event, equipment: await data.equipment({ label: "Other item" }), day: DAY, start: "09:00", end: "17:00" });
  const page = await as("tech");
  const availability = new EquipmentAvailabilityPage(page);
  const reservation = new EquipmentReservationPage(page);

  const morning = { date: DAY, start: "09:00", end: "12:00" };
  const afternoon = { date: DAY, start: "13:00", end: "17:00" };
  const wholeDay = { date: DAY, start: "09:00", end: "17:00" };

  await test.step("nothing reserved yet: all 10 units are free (18-S1)", async () => {
    const result = await availability.check(item.name, 1, morning);
    await expect(result).toContainText("Available");
    await availability.expectAvailable(result, item.name, 10);
  });

  await test.step("reserving 4 in the morning confirms and shows 6 still available (19-S1, 19-S2)", async () => {
    await reservation.open();
    await reservation.reserve({ eventName: event.name, equipmentName: item.name, quantity: 4, ...morning });
    await expect(reservation.confirmation).toContainText(`${item.name}: 4 reserved`);
    await expect(reservation.confirmation).toContainText("6 still available for that period");
    expect(await data.reservationsOf(item)).toEqual([{ status: "reserved", quantity_reserved: 4 }]);
  });

  await test.step("a period that overlaps it now shows 6 free (19-S3)", async () => {
    const result = await availability.check(item.name, 1, { date: DAY, start: "10:00", end: "13:00" });
    await availability.expectAvailable(result, item.name, 6);
  });

  await test.step("a period that starts exactly when the reservation ends is unaffected (boundary)", async () => {
    const result = await availability.check(item.name, 1, { date: DAY, start: "12:00", end: "13:00" });
    await availability.expectAvailable(result, item.name, 10);
  });

  await test.step("4 more in the afternoon: the whole day still has 6 free, the peak and not the sum (19-S11)", async () => {
    await reservation.open();
    await reservation.reserve({ eventName: event.name, equipmentName: item.name, quantity: 4, ...afternoon });
    await expect(reservation.confirmation).toContainText("6 still available for that period");

    const result = await availability.check(item.name, 1, wholeDay);
    await availability.expectAvailable(result, item.name, 6);
  });

  await test.step("the 6 left for the whole day can be reserved; none remain", async () => {
    await reservation.open();
    await reservation.reserve({ eventName: event.name, equipmentName: item.name, quantity: 6, ...wholeDay });
    await expect(reservation.confirmation).toContainText("0 still available for that period");

    const result = await availability.check(item.name, 1, wholeDay);
    await expect(result).toContainText("Insufficient");
    await availability.expectAvailable(result, item.name, 0);

    expect((await data.reservationsOf(item)).map((r) => r.quantity_reserved)).toEqual([4, 4, 6]);
  });
});
