import { BookingDecisionPage } from "../../pages/BookingPages";
import { VenueRequestPage } from "../../pages/VenueRequestPage";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-32 (request), 37 (the queue) and 38 (approve): the coordinator requests a venue and it is Pending; Venue Staff find it
// in their queue and approve it; the coordinator then sees it Approved and it has left the queue.
const t = tc("E2E-BOOK-01");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const venue = await data.venue();
  const event = await data.event();
  const coordinator = await as("coordinator");
  const venueStaff = await as("venueStaff");
  let bookingId = "";

  await test.step("the coordinator requests the venue and it is Pending (32)", async () => {
    const form = new VenueRequestPage(coordinator);
    await form.open(event.id);
    await form.fill({ venueName: venue.name, capacity: venue.max_capacity, date: DAY, start: "10:00", end: "12:00" });
    await form.submit();
    await expect(coordinator).toHaveURL(/\/venue-bookings\/[0-9a-f-]+$/);
    bookingId = coordinator.url().split("/").pop()!;
    await expect(coordinator.getByText(/pending/i).first()).toBeVisible();
    expect(await data.bookingsOf(event)).toEqual([{ id: bookingId, status: "requested" }]);
  });

  await test.step("Venue Staff see it in the queue and approve it (37, 38)", async () => {
    await venueStaff.goto("/booking-queue");
    await expect(venueStaff.getByRole("link", { name: new RegExp(event.name) }).first()).toBeVisible();

    const decision = new BookingDecisionPage(venueStaff);
    await decision.open(bookingId);
    await decision.approve();
    await expect.poll(async () => (await data.bookingsOf(event))[0].status).toBe("approved");

    await venueStaff.goto("/booking-queue");
    await expect(venueStaff.getByRole("link", { name: new RegExp(event.name) }), "a decided request leaves the queue").toHaveCount(0);
  });

  await test.step("the coordinator sees it Approved (33)", async () => {
    await coordinator.goto(`/venue-bookings/${bookingId}`);
    await expect(coordinator.getByText(/approved/i).first()).toBeVisible();
  });
});
