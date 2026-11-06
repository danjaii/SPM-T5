import { VenueRequestPage } from "../../pages/VenueRequestPage";
import { DAY, heldVenue } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-103-S2 (boundary): the holder occupies 09:30-12:45. A request for 13:15-15:00 needs setup from 12:45, so the two
// padded periods only touch. Half-open periods [start, end) do not overlap at a shared instant, so the request is accepted.
const t = tc("E2E-CONF-03");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const { venue, requester } = await heldVenue(data, { setupMinutes: 30, turnaroundMinutes: 45 });
  const page = await as("coordinator");
  const form = new VenueRequestPage(page);

  await form.open(requester.id);
  await form.fill({ venueName: venue.name, capacity: venue.max_capacity, date: DAY, start: "13:15", end: "15:00" });
  await form.submit();

  await expect(page).toHaveURL(/\/venue-bookings\/[0-9a-f-]+$/);
  await expect(page.getByText(/pending/i).first()).toBeVisible();

  // the screen shows a booking page; the database proves it is the requester's one booking and it is Pending ("requested")
  const bookings = await data.bookingsOf(requester);
  expect(bookings).toHaveLength(1);
  expect(bookings[0].status).toBe("requested");
});
