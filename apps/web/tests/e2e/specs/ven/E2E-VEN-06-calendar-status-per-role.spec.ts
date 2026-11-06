import { waitForHydration } from "../../fixtures/hydration";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-84/AC2 and AC8, SCRUM-130/AC1: the venue calendar shows a Pending booking request as Tentatively Held and an Approved one as
// Confirmed (the words on the screen), to the three roles that may open it; the Lead and the Safety Officer are refused. The
// calendar opens on today and only steps a day at a time, so unlike the other cases this one books tomorrow, not 2031.
const t = tc("E2E-VEN-06");

/** Tomorrow in Singapore time, as the calendar's day view counts it. */
const tomorrow = new Date(Date.now() + 8 * 3600e3 + 24 * 3600e3).toISOString().slice(0, 10);

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const venue = await data.venue({ capacity: 100, hours: ["08:00", "22:00"], label: "Calendar venue" });
  const pending = await data.event({ coordinator: "coordinator", label: "Pending event" });
  const approved = await data.event({ coordinator: "coordinator2", label: "Approved event" });
  await data.booking({ event: pending, venue, requestedBy: "coordinator", day: tomorrow, start: "10:00", end: "11:00", status: "requested" });
  await data.booking({ event: approved, venue, requestedBy: "coordinator2", day: tomorrow, start: "14:00", end: "15:00", status: "approved" });

  for (const person of ["coordinator", "venueStaff", "tech"] as const) {
    await test.step(`${person} sees the Pending request as Tentatively Held and the Approved one as Confirmed (84-AC2, 84-AC8)`, async () => {
      const page = await as(person);
      await page.goto("/venue-calendar");
      await waitForHydration(page, "button");
      await page.getByRole("button", { name: "Next day" }).click();
      await expect(page.getByRole("region", { name: `Venue timeline for ${tomorrow}` })).toBeVisible();

      const row = page.locator("[data-venue-row]").filter({ hasText: venue.name });
      await expect(row.getByRole("button", { name: /^Details: Tentatively Held Event/ }), "the Pending request").toHaveCount(1);
      await expect(row.getByRole("button", { name: /^Details: Confirmed Event/ }), "the Approved booking").toHaveCount(1);
    });
  }

  for (const person of ["lead", "safety"] as const) {
    await test.step(`${person} is refused the calendar (84-AC8)`, async () => {
      const page = await as(person);
      await page.goto("/venue-calendar");
      await expect(page).toHaveURL(/\/access-denied/);
    });
  }
});
