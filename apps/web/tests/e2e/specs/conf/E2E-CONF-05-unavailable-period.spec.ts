import { VenueRequestPage } from "../../pages/VenueRequestPage";
import { sgt } from "../../fixtures/data";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-105 (Week 7 change 2): a request into a period Venue Staff marked unavailable is refused and the refusal names the
// period. The venue's setup time counts: a request whose setup would run into the block is refused, and one whose padded
// period only touches the block's end is accepted (105-S4, 105-S5).
const t = tc("E2E-CONF-05");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const venue = await data.venue({ setupMinutes: 30 });
  const event = await data.event();
  // unavailable from 14 Nov 08:00 to 16 Nov 18:00
  await data.insert("venue_unavailability", {
    venue_id: venue.id,
    start_datetime: sgt("2031-11-14", "08:00"),
    end_datetime: sgt("2031-11-16", "18:00"),
    reason: "maintenance",
    created_by: await data.idOf("venueStaff"),
  });

  const coordinator = await as("coordinator");
  const form = new VenueRequestPage(coordinator);
  const request = async (date: string, start: string, end: string) => {
    await form.open(event.id);
    await form.fill({ venueName: venue.name, capacity: venue.max_capacity, date, start, end });
    await form.submit();
  };
  const unavailable = `${venue.name} is unavailable from 14 Nov 08:00 to 16 Nov 18:00`;

  await test.step("inside the block is refused and names the period, not the reason (105-S4)", async () => {
    await request("2031-11-15", "09:00", "17:00");
    await expect(form.refusal).toContainText(unavailable);
    await expect(form.refusal).not.toContainText(/maintenance/i);
  });

  await test.step("starting 15 minutes after the block ends is still refused: setup (30 min) would run into it (105-S5)", async () => {
    await request("2031-11-16", "18:15", "20:00");
    await expect(form.refusal).toContainText(unavailable);
  });

  await test.step("starting 30 minutes after it ends is accepted: the padded period only touches the block", async () => {
    await request("2031-11-16", "18:30", "20:00");
    await expect(coordinator).toHaveURL(/\/venue-bookings\/[0-9a-f-]+$/);
    expect(await data.bookingsOf(event)).toHaveLength(1);
  });
});
