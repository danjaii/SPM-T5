import { AttendeePages } from "../../pages/AttendeePages";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-73: an attendee withdraws from My registrations after confirming. The registration is kept as history (status
// Withdrawn, with the time), not deleted, and it shows as Withdrawn to them.
const t = tc("E2E-REG-02");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const event = await data.event({ status: "confirmed", day: DAY, start: "09:00", end: "17:00", registration: { capacity: 30 } });
  await data.insert("event_registrations", {
    event_id: event.id,
    attendee_id: await data.idOf("attendee"),
    status: "registered",
    registration_details: { name: "Alicia Fernandez", email: "alicia.fernandez@example.com", phone: "91234567" },
  });

  const attendee = await as("attendee");
  const pages = new AttendeePages(attendee);

  await test.step("before: the registration is Confirmed", async () => {
    await expect(await pages.row(event.name)).toContainText("Confirmed");
  });

  await test.step("Withdraw asks first, then the row reads Withdrawn", async () => {
    await pages.withdraw(event.name);
    await expect(await pages.row(event.name)).toContainText("Withdrawn");
  });

  await test.step("the registration is kept as history with the time it was withdrawn", async () => {
    const rows = await data.rest<{ status: string; withdrawn_at: string | null }[]>(`event_registrations?select=status,withdrawn_at&event_id=eq.${event.id}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("withdrawn");
    expect(Date.now() - Date.parse(rows[0].withdrawn_at!)).toBeLessThan(5 * 60_000);
  });
});
