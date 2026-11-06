import { callAs } from "../../fixtures/api";
import { SERVICE_URL } from "../../fixtures/env";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-98/AC6 (98-S26, 98-S27): a coordinator the event is NOT assigned to cannot request a venue for it or list its
// bookings, and is told 403.
//
// KNOWN DEFECT D-002 (docs/testing/e2e/defects.md): on the real stack the service answers 404, not 403. Since SCRUM-156
// (migration 59) a coordinator reads only the events assigned to them, so for any other coordinator the event looks like it
// does not exist. Access is refused either way, but the written AC says 403. The assertion is not weakened: the test is
// marked as expected to fail, and Playwright reports an unexpected pass the day the behaviour or the spec is brought into
// line. The positive control (the assigned coordinator is allowed) lives in E2E-ACL-02, so a broken setup cannot hide here.
const t = tc("E2E-ACL-05");

test(t.title, { annotation: [...t.annotation, { type: "defect", description: "D-002" }] }, async ({ as, data }) => {
  test.fail(true, "D-002: an unassigned coordinator gets 404, spec 98-S26/S27 says 403");

  const venue = await data.venue();
  const event = await data.event(); // assigned to the first coordinator
  const other = await as("coordinator2");
  const base = SERVICE_URL.venue;

  await test.step("requesting a venue for an event assigned to someone else is refused with 403 (98-S26)", async () => {
    const { status } = await callAs(other, "POST", `${base}/venue-bookings`, { eventId: event.id, venueId: venue.id, date: DAY, startTime: "10:00", endTime: "12:00" });
    expect(status).toBe(403);
    expect(await data.bookingsOf(event), "no booking was created").toEqual([]);
  });

  await test.step("listing that event's bookings is refused with 403 (98-S27)", async () => {
    const { status } = await callAs(other, "GET", `${base}/events/${event.id}/venue-bookings`);
    expect(status).toBe(403);
  });
});
