import { EventEditPage } from "../../pages/EventEditPage";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-111, 112, 113 (feature 7, minor versus critical updates): a minor edit (the purpose) saves at once and disturbs nothing; a
// critical edit (the date) first lists what it affects, and "Save anyway" sends the approved booking back to Pending and takes a
// Confirmed event back to Planning.
const t = tc("E2E-EVT-04");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const NEXT_DAY = "2031-11-15";
  const venue = await data.venue();
  const event = await data.event({ status: "confirmed", day: DAY, start: "09:00", end: "17:00" });
  const booking = await data.booking({ event, venue, requestedBy: "coordinator", day: DAY, start: "09:00", end: "17:00", status: "approved" });

  const coordinator = await as("coordinator");
  const edit = new EventEditPage(coordinator);
  const eventRow = async () => (await data.rest<{ status: string; purpose: string | null }[]>(`events?select=status,purpose&id=eq.${event.id}`))[0];
  const bookingStatus = async () => (await data.bookingsOf(event)).find((b) => b.id === booking.id)?.status;

  await test.step("a minor edit saves straight away and nothing else changes (111)", async () => {
    await edit.open(event.id);
    await coordinator.getByLabel("Purpose").fill("A refreshed purpose statement.");
    await edit.save();
    await expect(coordinator).toHaveURL(new RegExp(`/events/${event.id}\\?saved=1`));
    expect(await eventRow()).toEqual({ status: "confirmed", purpose: "A refreshed purpose statement." });
    expect(await bookingStatus()).toBe("approved");
  });

  await test.step("moving the date lists the approved venue booking and saves nothing yet (112-S8)", async () => {
    await edit.open(event.id);
    await coordinator.getByLabel("Date", { exact: true }).fill(NEXT_DAY);
    await coordinator.getByLabel("End date", { exact: true }).fill(NEXT_DAY);
    await edit.save();
    await expect(edit.warning).toBeVisible();
    await expect(edit.affected).toHaveCount(1);
    await expect(edit.affected.first()).toContainText(venue.name);
    expect(await bookingStatus()).toBe("approved");
  });

  await test.step("Save anyway sends the booking back to Pending and the Confirmed event back to Planning (113-S1, S9)", async () => {
    await edit.saveAnyway();
    await expect(coordinator).toHaveURL(new RegExp(`/events/${event.id}\\?saved=1`));
    expect(await bookingStatus()).toBe("requested");
    expect((await eventRow()).status).toBe("planning");
  });
});
