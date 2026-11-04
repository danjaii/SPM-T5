import { VenueRequestPage } from "../../pages/VenueRequestPage";
import { DAY, heldVenue } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-103 (the customer's worked example, Week 7 change 1): a booking occupies [start - setup, end + turnaround).
// 10:00-12:00 with 30 minutes setup and 45 minutes turnaround occupies 09:30-12:45.
const t = tc("E2E-CONF-02");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const { venue, requester } = await heldVenue(data, { setupMinutes: 30, turnaroundMinutes: 45 });
  const page = await as("coordinator");
  const form = new VenueRequestPage(page);

  // 103-S1: 12:30-14:00 starts inside the turnaround that follows the holder (until 12:45); 103-S3: 08:00-08:50 needs setup
  // from 07:30 to 09:35 (setup and turnaround are the venue's), which runs into the holder's setup at 09:30
  for (const [start, end] of [["12:30", "14:00"], ["08:00", "08:50"]]) {
    await test.step(`${start}-${end} is refused with the occupied period`, async () => {
      await form.open(requester.id);
      await form.fill({ venueName: venue.name, capacity: venue.max_capacity, date: DAY, start, end });
      await form.submit();

      await expect(form.refusal).toContainText(`${venue.name} is occupied from 09:30 to 12:45, including setup and turnaround`);
      await expect(page).toHaveURL(/\/venue-request$/);
    });
  }

  expect(await data.bookingsOf(requester), "no booking was created for the requesting event").toEqual([]);
});
