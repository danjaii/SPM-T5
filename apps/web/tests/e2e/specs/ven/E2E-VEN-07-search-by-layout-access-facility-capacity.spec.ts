import { VenueFiltersPage } from "../../pages/VenueJourneyPages";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-65 (65-S2, S3, S5) and the brief ("search and filter by date, time, expected attendance, location, capacity, accessibility,
// supported layout and required facilities"): the layout, "Accessible venue", facility and people filters each narrow the venues, and
// together they keep only the venue that meets all of them. E2E-VEN-01 covers date, time and location.
const t = tc("E2E-VEN-07");
const OPEN: [string, string] = ["07:00", "23:00"];
const PROJECTOR = "Projector & Screen";

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const [projector] = await data.rest<{ id: string }[]>("facilities?select=id&name=eq.Projector%20%26%20Screen");
  const withProjector = async (venue: { id: string }) => data.rest("venue_facilities", { method: "POST", body: JSON.stringify({ venue_id: venue.id, facility_id: projector.id }) });
  // all hold 100 unless said; Theatre unless said
  const alpha = await data.venue({ label: "Alpha", capacity: 100, hours: OPEN, layout: "Theatre", accessible: true });
  await withProjector(alpha); // Theatre, accessible, projector
  const gamma = await data.venue({ label: "Gamma", capacity: 100, hours: OPEN, layout: "Theatre" }); // Theatre only
  const epsilon = await data.venue({ label: "Epsilon", capacity: 100, hours: OPEN, layout: "Theatre", accessible: true }); // Theatre, accessible, no projector
  const beta = await data.venue({ label: "Beta", capacity: 100, hours: OPEN, layout: "Classroom", accessible: true });
  await withProjector(beta); // everything but the Theatre layout
  const delta = await data.venue({ label: "Delta", capacity: 20, hours: OPEN, layout: "Theatre", accessible: true });
  await withProjector(delta); // everything but the room for 50

  const coordinator = await as("coordinator");
  const filters = new VenueFiltersPage(coordinator);
  const form = await filters.open();
  const search = async (opts: { layout?: string; accessible?: boolean; facility?: string; people: number }) => {
    await filters.reset();
    if (opts.layout) await form.getByRole("button", { name: opts.layout, exact: true }).click();
    if (opts.accessible) await form.getByRole("checkbox", { name: "Accessible venue" }).click();
    if (opts.facility) await form.getByRole("checkbox", { name: opts.facility }).click();
    await filters.apply({ date: DAY, start: "13:00", end: "15:00", people: opts.people });
  };
  const only = async (shown: { name: string }[]) => {
    for (const v of [alpha, beta, gamma, delta, epsilon]) {
      const want = shown.some((s) => s.name === v.name);
      await expect(filters.result(v.name), `${v.name} ${want ? "is" : "is not"} offered`).toHaveCount(want ? 1 : 0);
    }
  };

  await test.step("the Theatre layout alone keeps the Theatre venues that hold 50 (65-S3)", async () => {
    await search({ layout: "Theatre", people: 50 });
    await only([alpha, gamma, epsilon]); // Beta has no Theatre, Delta holds only 20
  });

  await test.step("Theatre and Accessible venue keep the accessible ones (65-S3)", async () => {
    await search({ layout: "Theatre", accessible: true, people: 50 });
    await only([alpha, epsilon]);
  });

  await test.step("Theatre and a projector keep the venue with one (65-S3)", async () => {
    await search({ layout: "Theatre", facility: PROJECTOR, people: 50 });
    await only([alpha]);
  });

  await test.step("all of them together keep only the venue that meets every one (65-S2)", async () => {
    await search({ layout: "Theatre", accessible: true, facility: PROJECTOR, people: 50 });
    await only([alpha]);
  });

  await test.step("more people than any of them holds leaves none of them (65-S5)", async () => {
    await search({ layout: "Theatre", people: 120 });
    await only([]);
  });
});
