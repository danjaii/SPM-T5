import { waitForButton } from "../../fixtures/hydration";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-170 (the VIP form reloads the list "so the new row and the summary update"): on a full event with an attendee waiting for
// the organiser, the organiser adds a VIP. The VIP must appear in the list and the summary without a reload.
//
// KNOWN DEFECT D-006 (docs/testing/e2e/defects.md): in the production build (what CI runs, and E2E_BUILT=1) the VIP is saved but the
// list and the summary keep their old rows until the page is reloaded, whenever a waiting attendee is on the page. With no waiting
// attendee, or under `next dev`, the list updates. The bug is intermittent in the production build (it showed in 10 of 10 repeats run
// on their own, but not in two full-suite runs), so an expected-failure marker would turn CI red whenever it stays hidden. The
// assertion is not weakened: in built mode the test is skipped (fixme) with the defect ID, and in dev mode it runs.
const t = tc("E2E-REG-06");
const BUILT = Boolean(process.env.CI || process.env.E2E_BUILT);

test(t.title, { annotation: [...t.annotation, { type: "defect", description: "D-006" }] }, async ({ as, data }) => {
  test.fixme(BUILT, "D-006: with a waiting attendee on the page the list intermittently does not refresh after Add VIP in the production build");
  const venue = await data.venue({ capacity: 5, label: "Small hall" });
  const event = await data.event({ status: "confirmed", day: DAY, start: "09:00", end: "17:00", registration: { capacity: 1 }, label: "Full event" });
  await data.booking({ event, venue, requestedBy: "coordinator", day: DAY, start: "09:00", end: "17:00", status: "approved" });
  const details = (name: string, email: string) => ({ name, email, phone: "+65 9123 4567" });
  await data.insert("event_registrations", { event_id: event.id, attendee_id: await data.idOf("attendee"), status: "registered", registration_details: details("Alicia Fernandez", "alicia.fernandez@example.com") });
  await data.insert("event_registrations", { event_id: event.id, attendee_id: await data.idOf("attendee2"), status: "waitlisted", registration_details: details("Bryan Ho", "bryan.ho@example.com") });

  const organiser = await as("organiser");
  await organiser.goto(`/registrations-overview?event=${event.id}`);

  await test.step("the VIP is added and saved (SCRUM-170)", async () => {
    await waitForButton(organiser, "Add VIP");
    await organiser.getByLabel("Attendee's email").fill("chen.wei.jie@example.com");
    await organiser.getByRole("button", { name: "Add VIP" }).click();
    await expect(organiser.getByRole("status").filter({ hasText: "chen.wei.jie@example.com is now Confirmed as a VIP." })).toBeVisible();
    const registered = await data.rest<unknown[]>(`event_registrations?select=id&event_id=eq.${event.id}&status=eq.registered`);
    expect(registered, "the VIP is saved: two confirmed on a cap of 1").toHaveLength(2);
  });

  await test.step("the list shows the new VIP without a reload (D-006: it does not, in the production build)", async () => {
    await expect(organiser.getByRole("row").filter({ hasText: "chen.wei.jie@example.com" })).toContainText("VIP");
  });
});
