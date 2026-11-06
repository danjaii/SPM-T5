import { AttendeePages } from "../../pages/AttendeePages";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-169 (boundary): at capacity. The first attendee fills the last place and is Confirmed; the next one can still ask, is told
// the event is full, and is Pending until the organiser decides.
const t = tc("E2E-REG-03");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const event = await data.event({ status: "confirmed", day: DAY, start: "09:00", end: "17:00", registration: { capacity: 1 } });
  const statuses = async () =>
    (await data.rest<{ status: string; attendee_id: string }[]>(`event_registrations?select=status,attendee_id&event_id=eq.${event.id}`));

  await test.step("the first attendee takes the only place and is Confirmed", async () => {
    const page = await as("attendee");
    const pages = new AttendeePages(page);
    await (await pages.findRegisterButton(event.id, event.name)).click();
    await pages.register({ name: "Alicia Fernandez", email: "alicia.fernandez@example.com", phone: "91234567" });
    await expect(pages.registered).toContainText("Confirmed");
  });

  await test.step("the second attendee is told the event is full and is Pending", async () => {
    const page = await as("attendee2");
    const pages = new AttendeePages(page);
    await (await pages.findRegisterButton(event.id, event.name)).click();
    await pages.register({ name: "Bryan Ho", email: "bryan.ho@example.com", phone: "98765432" });
    await expect(page.getByRole("status").filter({ hasText: `This event is full, so your registration for ${event.name} is waiting for the organiser.` })).toBeVisible();
  });

  await test.step("the database has one registered and one waitlisted, no more than the capacity confirmed", async () => {
    const rows = await statuses();
    expect(rows.map((r) => r.status).sort()).toEqual(["registered", "waitlisted"]);
    expect(rows.find((r) => r.status === "registered")!.attendee_id).toBe(await data.idOf("attendee"));
  });
});
