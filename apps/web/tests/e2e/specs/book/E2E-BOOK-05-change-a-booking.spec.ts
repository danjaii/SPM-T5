import { EventBookingsPage } from "../../pages/BookingPages";
import { DAY, heldVenue } from "../../fixtures/scenarios";
import { sgt } from "../../fixtures/data";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-102 (Week 7 change 3): changing one booking. Into a period another event holds is refused and changes nothing;
// stretching it within its own period is allowed (it does not clash with itself, 102-S6); an approved booking then goes
// back to Pending for Venue Staff to decide again (102-S2).
const t = tc("E2E-BOOK-05");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  // another event holds the venue 10:00-12:00; the coordinator's own event has an approved booking 08:00-09:00 there
  const { venue, requester } = await heldVenue(data);
  const mine = await data.booking({ event: requester, venue, requestedBy: "coordinator", day: DAY, start: "08:00", end: "09:00", status: "approved" });

  const coordinator = await as("coordinator");
  const bookings = new EventBookingsPage(coordinator);
  const stored = async () =>
    (await data.rest<{ status: string; event_start_datetime: string; event_end_datetime: string }[]>(`venue_bookings?select=status,event_start_datetime,event_end_datetime&id=eq.${mine.id}`))[0];
  const same = (iso: string, hhmm: string) => Date.parse(iso) === Date.parse(sgt(DAY, hhmm));

  await test.step("changing into the other event's period is refused and changes nothing (102-S4)", async () => {
    await bookings.openChange(mine.id);
    await bookings.change({ start: "09:30", end: "10:30" });
    await expect(coordinator.getByRole("alert").filter({ hasText: "occupied from 10:00 to 12:00" })).toBeVisible();

    const row = await stored();
    expect(row.status).toBe("approved");
    expect(same(row.event_start_datetime, "08:00") && same(row.event_end_datetime, "09:00"), "times unchanged").toBe(true);
  });

  await test.step("stretching it within its own period is allowed and sends it back to Pending (102-S6, S2)", async () => {
    await bookings.openChange(mine.id);
    await bookings.change({ start: "08:00", end: "09:30" }); // overlaps its own old period 08:00-09:00
    await expect.poll(async () => (await stored()).status).toBe("requested");
    const row = await stored();
    expect(same(row.event_start_datetime, "08:00") && same(row.event_end_datetime, "09:30"), "new times saved").toBe(true);
  });
});
