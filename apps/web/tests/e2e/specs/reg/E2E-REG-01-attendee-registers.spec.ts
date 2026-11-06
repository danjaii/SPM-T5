import { AttendeePages } from "../../pages/AttendeePages";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-83 (register, My registrations, an event's registrations): an attendee finds a confirmed event with registration open,
// registers, sees the registration in My registrations; the organiser and the assigned coordinator see them on the event.
const t = tc("E2E-REG-01");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const event = await data.event({ status: "confirmed", day: DAY, start: "09:00", end: "17:00", registration: { capacity: 30 } });
  const attendee = await as("attendee");
  const pages = new AttendeePages(attendee);
  const who = { name: "Alicia Fernandez", email: "alicia.fernandez@example.com", phone: "91234567" };

  await test.step("the attendee finds the event and registers (confirmed, there is room)", async () => {
    const register = await pages.findRegisterButton(event.id, event.name);
    await expect(register).toBeVisible();
    await register.click();
    await pages.register(who);
    await expect(pages.registered).toContainText("Confirmed");
    const rows = await data.rest<{ status: string }[]>(`event_registrations?select=status&event_id=eq.${event.id}`);
    expect(rows).toEqual([{ status: "registered" }]);
  });

  await test.step("it is listed in My registrations", async () => {
    await expect(await pages.row(event.name)).toContainText("Confirmed");
  });

  await test.step("the organiser and the coordinator see the attendee on the event's registrations", async () => {
    for (const person of ["organiser", "coordinator"] as const) {
      const page = await as(person);
      await page.goto(`/events/${event.id}/registrations`);
      const row = page.getByRole("row").filter({ hasText: who.email });
      await expect(row, person).toContainText(who.name);
      await expect(row).toContainText("Confirmed");
    }
  });
});
