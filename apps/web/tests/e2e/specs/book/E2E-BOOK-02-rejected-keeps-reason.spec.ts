import { BookingDecisionPage } from "../../pages/BookingPages";
import { VenueRequestPage } from "../../pages/VenueRequestPage";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-39 (failure path): Venue Staff reject a pending request with a reason; the reason is kept and shown to the
// coordinator, the request leaves the queue, and the slot is free again for another event (39-S4).
const t = tc("E2E-BOOK-02");

const REASON = "Reserved for a maintenance inspection that day.";

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const venue = await data.venue();
  const event = await data.event({ label: "Rejected" });
  const other = await data.event({ coordinator: "coordinator", label: "Next in line" });
  const booking = await data.booking({ event, venue, requestedBy: "coordinator", day: DAY, start: "10:00", end: "12:00", status: "requested" });

  const venueStaff = await as("venueStaff");
  await test.step("Venue Staff reject it with a reason", async () => {
    const decision = new BookingDecisionPage(venueStaff);
    await decision.open(booking.id);
    await decision.reject(REASON);
    await expect.poll(async () => (await data.bookingsOf(event))[0].status).toBe("rejected");
  });

  await test.step("the reason is stored and the coordinator is shown it (39-S1)", async () => {
    const [row] = await data.rest<{ review_notes: string; reviewed_by: string }[]>(`venue_bookings?select=review_notes,reviewed_by&id=eq.${booking.id}`);
    expect(row.review_notes).toBe(REASON);
    expect(row.reviewed_by).toBe(await data.idOf("venueStaff"));

    const coordinator = await as("coordinator");
    await coordinator.goto(`/venue-bookings/${booking.id}`);
    await expect(coordinator.getByText(/rejected/i).first()).toBeVisible();
    await expect(coordinator.getByText(REASON)).toBeVisible();
  });

  await test.step("the slot is free again: another event can now request it (39-S4)", async () => {
    const coordinator = await as("coordinator");
    const form = new VenueRequestPage(coordinator);
    await form.open(other.id);
    await form.fill({ venueName: venue.name, capacity: venue.max_capacity, date: DAY, start: "10:00", end: "12:00" });
    await form.submit();
    await expect(coordinator).toHaveURL(/\/venue-bookings\/[0-9a-f-]+$/);
  });
});
