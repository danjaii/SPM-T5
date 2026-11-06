import { callAs } from "../../fixtures/api";
import { SERVICE_URL } from "../../fixtures/env";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-98/AC6 (98-S26, 98-S27): a coordinator the event is NOT assigned to cannot request a venue for it or list its
// bookings, and is told 404.
//
// Why 404 and not 403 (spec 98, Implementation decisions; closed defect D-002 in docs/testing/e2e/defects.md): since
// SCRUM-156 (migration 59) a coordinator reads only the events assigned to them, so to any other coordinator the event looks
// as if it does not exist. That is also SCRUM-156's answer for reading the event itself, and it does not reveal that the
// event exists. The positive control (the assigned coordinator is allowed) lives in E2E-ACL-02, so a broken setup cannot hide
// here.
const t = tc("E2E-ACL-05");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const venue = await data.venue();
  const event = await data.event(); // assigned to the first coordinator
  const other = await as("coordinator2");
  const base = SERVICE_URL.venue;

  await test.step("requesting a venue for an event assigned to someone else is refused with 404 (98-S26)", async () => {
    const { status } = await callAs(other, "POST", `${base}/venue-bookings`, { eventId: event.id, venueId: venue.id, date: DAY, startTime: "10:00", endTime: "12:00" });
    expect(status).toBe(404);
    expect(await data.bookingsOf(event), "no booking was created").toEqual([]);
  });

  await test.step("listing that event's bookings is refused with 404 (98-S27)", async () => {
    const { status } = await callAs(other, "GET", `${base}/events/${event.id}/venue-bookings`);
    expect(status).toBe(404);
  });
});
