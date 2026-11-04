import { VenueFiltersPage } from "../../pages/VenueJourneyPages";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-65 (venue search): the filters narrow the catalogue to venues that are free at the asked time, big enough and in the
// asked place; Reset clears them. Only this test's own venues are asserted on (the seeded ones also come back).
const t = tc("E2E-VEN-01");

const OPEN: [string, string] = ["07:00", "23:00"];

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const alpha = await data.venue({ label: "Alpha", capacity: 100, hours: OPEN, address: "1 Alpha Road, Singapore" });
  const beta = await data.venue({ label: "Beta", capacity: 10, hours: OPEN, address: "2 Beta Road, Singapore" }); // too small for 50
  const gamma = await data.venue({ label: "Gamma", capacity: 100, hours: OPEN, address: "9 Zetaville Crescent, Singapore" });
  // another event holds Alpha from 10:00 to 11:00
  const other = await data.event({ coordinator: "coordinator2", label: "Other" });
  await data.booking({ event: other, venue: alpha, requestedBy: "coordinator2", day: DAY, start: "10:00", end: "11:00", status: "approved" });

  const coordinator = await as("coordinator");
  const filters = new VenueFiltersPage(coordinator);

  await test.step("9:00 to 12:00 for 50 people: Gamma only (Alpha is held at 10:00, Beta is too small)", async () => {
    await filters.open();
    await filters.apply({ date: DAY, start: "09:00", end: "12:00", people: 50 });
    await expect(filters.result(gamma.name)).toBeVisible();
    await expect(filters.result(alpha.name), "held by another event").toHaveCount(0);
    await expect(filters.result(beta.name), "holds only 10").toHaveCount(0);
  });

  await test.step("13:00 to 15:00 for 50 people: Alpha is free now, Beta still too small", async () => {
    await filters.apply({ date: DAY, start: "13:00", end: "15:00", people: 50 });
    await expect(filters.result(alpha.name)).toBeVisible();
    await expect(filters.result(gamma.name)).toBeVisible();
    await expect(filters.result(beta.name)).toHaveCount(0);
  });

  await test.step("adding a location narrows it to the matching address", async () => {
    await filters.apply({ date: DAY, start: "13:00", end: "15:00", people: 50, location: "Zetaville" });
    await expect(filters.result(gamma.name)).toBeVisible();
    await expect(filters.result(alpha.name)).toHaveCount(0);
  });

  await test.step("Reset clears the filters", async () => {
    await filters.reset();
    await expect(filters.activeFilters).toHaveCount(0);
  });
});
