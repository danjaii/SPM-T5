import { EventEditPage } from "../../pages/EventEditPage";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-111, 112, 113: attendance is an important detail. Raising it past what a booked venue holds first lists the affected
// arrangement (nothing is saved); Go back leaves everything as it was; Save anyway saves it and sends the booking back to
// Pending so Venue Staff look at it again.
const t = tc("E2E-CHG-04");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const venue = await data.venue({ capacity: 500, label: "Hall for 500" });
  const event = await data.event({ status: "planning", attendance: 480, day: DAY, start: "09:00", end: "17:00" });
  const booking = await data.booking({ event, venue, requestedBy: "coordinator", day: DAY, start: "09:00", end: "17:00", status: "approved", attendance: 480 });

  const coordinator = await as("coordinator");
  const edit = new EventEditPage(coordinator);
  const stored = async () =>
    (await data.rest<{ expected_attendance: number }[]>(`events?select=expected_attendance&id=eq.${event.id}`))[0].expected_attendance;
  const bookingStatus = async () => (await data.bookingsOf(event)).find((b) => b.id === booking.id)?.status;

  await test.step("raising 480 to 600 lists the booked venue before anything is saved (112-S4)", async () => {
    await edit.open(event.id);
    await edit.setAttendance(600);
    await edit.save();
    await expect(edit.warning.getByRole("heading", { name: "Check affected arrangements" })).toBeVisible();
    await expect(edit.affected).toHaveCount(1);
    await expect(edit.affected.first()).toContainText(venue.name);
    expect(await stored(), "nothing saved yet").toBe(480);
  });

  await test.step("Go back changes nothing (112-S13)", async () => {
    await edit.goBack();
    expect(await stored()).toBe(480);
    expect(await bookingStatus()).toBe("approved");
  });

  await test.step("Save anyway saves it and sends the booking back to Pending (112-S14, 113-S1)", async () => {
    await edit.save();
    await expect(edit.warning).toBeVisible();
    await edit.saveAnyway();
    await expect(coordinator).toHaveURL(new RegExp(`/events/${event.id}\\?saved=1`));
    expect(await stored()).toBe(600);
    expect(await bookingStatus(), "Venue Staff decide again").toBe("requested");
  });
});
