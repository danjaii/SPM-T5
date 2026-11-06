import { ChangeRequestFormPage } from "../../pages/ChangeRequestPages";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-176: while a change to a detail is waiting for the coordinator, a second request for the SAME detail is refused and
// says so (176-S1), the form warns about what is already waiting (176-S8), and a request for a DIFFERENT detail is fine
// (176-S4). Nothing is saved when it is refused.
const t = tc("E2E-CHG-06");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const event = await data.event({ status: "planning", attendance: 50, day: DAY, start: "09:00", end: "17:00" });
  const organiser = await as("organiser");
  const form = new ChangeRequestFormPage(organiser);
  const pending = async () =>
    (await data.rest<{ status: string }[]>(`event_change_requests?select=status&event_id=eq.${event.id}&status=eq.pending`)).length;

  await test.step("a first request for attendance is accepted and waits", async () => {
    await form.open(event.id);
    await form.requestAttendance(60);
    await expect(organiser.getByText(/submitted for approval/)).toBeVisible();
    expect(await pending()).toBe(1);
  });

  await test.step("the form now says what is already waiting (176-S8)", async () => {
    await form.open(event.id);
    await expect(organiser.getByText(/Already waiting for your coordinator: .*expected attendance/)).toBeVisible();
  });

  await test.step("a second request for attendance is refused, naming it, and nothing is saved (176-S1)", async () => {
    await form.requestAttendance(70);
    await expect(organiser.getByText(/expected attendance/i).filter({ hasText: /coordinator/i }).first()).toBeVisible();
    expect(await pending(), "still only the first request").toBe(1);
  });

  await test.step("a request for a different detail is accepted (176-S4)", async () => {
    await form.open(event.id);
    await organiser.getByLabel("Expected attendance").fill("50"); // back to its current value, so only the requirements differ
    await form.requestVenueRequirements("Two breakout rooms next to the main hall.");
    await expect(organiser.getByText(/submitted for approval/)).toBeVisible();
    expect(await pending()).toBe(2);
  });
});
