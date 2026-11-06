import { BookingDecisionPage } from "../../pages/BookingPages";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-40: Venue Staff reject a request and suggest another venue, date and time; the coordinator sees the suggestion and
// accepts it, which creates a new Pending request for that venue and time.
const t = tc("E2E-BOOK-03");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const original = await data.venue({ label: "First choice" });
  const suggested = await data.venue({ label: "Suggested" });
  const event = await data.event();
  const booking = await data.booking({ event, venue: original, requestedBy: "coordinator", day: DAY, start: "10:00", end: "12:00", status: "requested" });
  const NEXT_DAY = "2031-11-15";

  const venueStaff = await as("venueStaff");
  const coordinator = await as("coordinator");

  await test.step("Venue Staff reject and suggest an alternative", async () => {
    const decision = new BookingDecisionPage(venueStaff);
    await decision.open(booking.id);
    await decision.reject("The hall is taken that morning.", { venueName: suggested.name, date: NEXT_DAY, start: "09:00", end: "17:00" });
    await expect.poll(async () => (await data.bookingsOf(event)).find((b) => b.id === booking.id)?.status).toBe("rejected");
  });

  await test.step("the coordinator sees the suggestion", async () => {
    await coordinator.goto(`/venue-bookings/${booking.id}`);
    await expect(coordinator.getByRole("heading", { name: "Suggested alternative" })).toBeVisible();
    await expect(coordinator.getByText(new RegExp(`${suggested.name} on ${NEXT_DAY}`))).toBeVisible();
  });

  await test.step("accepting it creates a new Pending request for the suggested venue and time", async () => {
    await coordinator.getByRole("button", { name: "Accept suggested alternative" }).click();
    await expect.poll(async () => (await data.bookingsOf(event)).length).toBe(2);

    const rows = await data.rest<{ id: string; status: string; venue_id: string; from_suggestion: boolean }[]>(
      `venue_bookings?select=id,status,venue_id,from_suggestion&event_id=eq.${event.id}&id=neq.${booking.id}`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "requested", venue_id: suggested.id, from_suggestion: true });
  });
});
