import { VenueRequestPage } from "../../pages/VenueRequestPage";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-98/AC3 (Week 7 change 3): one event can hold several venues, but not the same venue twice for overlapping times. The
// refusal says it is this event's own booking; a different venue at the same time is fine.
const t = tc("E2E-CONF-04");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const hall = await data.venue({ label: "Hall" });
  const annex = await data.venue({ label: "Annex" });
  const event = await data.event();
  await data.booking({ event, venue: hall, requestedBy: "coordinator", day: DAY, start: "10:00", end: "12:00", status: "requested" });

  const coordinator = await as("coordinator");
  const form = new VenueRequestPage(coordinator);

  await test.step("the same venue again, overlapping its own booking, is refused as a duplicate (98-S13)", async () => {
    await form.open(event.id);
    await form.fill({ venueName: hall.name, capacity: hall.max_capacity, date: DAY, start: "11:00", end: "13:00" });
    await form.submit();
    await expect(form.refusal).toContainText("This event already holds this venue for part of that period.");
    expect(await data.bookingsOf(event), "no second booking").toHaveLength(1);
  });

  await test.step("a different venue at the same time is accepted (98-S4)", async () => {
    await form.open(event.id);
    await form.fill({ venueName: annex.name, capacity: annex.max_capacity, date: DAY, start: "11:00", end: "13:00" });
    await form.submit();
    await expect(coordinator).toHaveURL(/\/venue-bookings\/[0-9a-f-]+$/);
    expect(await data.bookingsOf(event)).toHaveLength(2);
  });
});
