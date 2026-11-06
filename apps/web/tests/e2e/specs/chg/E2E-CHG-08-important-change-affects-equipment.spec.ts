import { sgt } from "../../fixtures/data";
import { DAY } from "../../fixtures/scenarios";
import { EventEditPage } from "../../pages/EventEditPage";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-112 and SCRUM-113 (docs/specs/important-change-impact.md, send-back-affected-arrangements.md), and the brief: an important
// change to an event (its date) may affect arrangements already made, equipment as well as venues. The warning lists the Arranged
// equipment request next to the venue booking and saves nothing; Go back changes nothing; Save anyway sends both back for review.
const t = tc("E2E-CHG-08");
const NEXT_DAY = "2031-11-15";

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const venue = await data.venue({ label: "Booked venue" });
  const item = await data.equipment({ totalQuantity: 5 });
  const event = await data.event({ status: "planning", day: DAY, start: "09:00", end: "17:00", attendance: 50 });
  const booking = await data.booking({ event, venue, requestedBy: "coordinator", day: DAY, start: "09:00", end: "17:00", status: "approved" });
  const reservation = await data.insert<{ id: string }>("equipment_reservations", {
    event_id: event.id, equipment_id: item.id, quantity_requested: 2, status: "approved",
    start_datetime: sgt(DAY, "09:00"), end_datetime: sgt(DAY, "17:00"),
  });
  const coordinator = await as("coordinator");
  const edit = new EventEditPage(coordinator);
  const bookingStatus = async () => (await data.bookingsOf(event)).find((b) => b.id === booking.id)?.status;
  const reservationStatus = async () => (await data.rest<{ status: string }[]>(`equipment_reservations?select=status&id=eq.${reservation.id}`))[0].status;

  await test.step("moving the date lists the venue booking and the Arranged equipment request, and saves nothing yet (112-S8)", async () => {
    await edit.open(event.id);
    await coordinator.getByLabel("Date", { exact: true }).fill(NEXT_DAY);
    await coordinator.getByLabel("End date", { exact: true }).fill(NEXT_DAY);
    await edit.save();
    await expect(edit.warning).toBeVisible();
    await expect(edit.affected, "one venue booking and one equipment request").toHaveCount(2);
    await expect(edit.warning).toContainText(venue.name);
    await expect(edit.warning).toContainText(item.name);
    expect(await bookingStatus()).toBe("approved");
    expect(await reservationStatus()).toBe("approved");
  });

  await test.step("Go back changes nothing", async () => {
    await edit.goBack();
    expect(await bookingStatus()).toBe("approved");
    expect(await reservationStatus()).toBe("approved");
  });

  await test.step("Save anyway sends the booking and the equipment request back for review (113-S1, S3)", async () => {
    await edit.save();
    await expect(edit.warning).toBeVisible();
    await edit.saveAnyway();
    await expect(coordinator).toHaveURL(new RegExp(`/events/${event.id}\\?saved=1`));
    expect(await bookingStatus(), "Venue Staff decide again").toBe("requested");
    expect(await reservationStatus(), "Technical Support review it again").toBe("requested");
  });
});
