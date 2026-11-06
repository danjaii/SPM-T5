import { DAY } from "../../fixtures/scenarios";
import { VenueRequestPage } from "../../pages/VenueRequestPage";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-109 (109-S1, S3): the suitability check compares the event's layout and attendance with the venue. A venue that does not
// support the event's layout is Not suitable with the layout line Not met. Facilities are never judged: the event has no
// required-facilities field, so that line is Not checked (a deliberate narrowing, spec 109 "Only what is stored today is checked").
const t = tc("E2E-VEN-08");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const [theatre] = await data.rest<{ id: string }[]>("room_layouts?select=id&name=eq.Theatre");
  const event = await data.event({ attendance: 80 });
  await data.rest(`events?id=eq.${event.id}`, { method: "PATCH", body: JSON.stringify({ preferred_room_layout_id: theatre.id }) });
  const fits = await data.venue({ capacity: 100, layout: "Theatre", label: "Has the layout" });
  const wrongLayout = await data.venue({ capacity: 100, layout: "Classroom", label: "Other layout" });

  const coordinator = await as("coordinator");
  const form = new VenueRequestPage(coordinator);
  const report = coordinator.getByRole("region", { name: "Venue suitability" });
  const line = (status: string) => report.locator(`[data-status="${status}"]`);
  const times = { date: DAY, start: "10:00", end: "12:00" };

  await test.step("a venue that does not support the event's layout is Not suitable and the layout line is Not met (109-S3)", async () => {
    await form.open(event.id);
    await form.fill({ venueName: wrongLayout.name, capacity: wrongLayout.max_capacity, ...times });
    await coordinator.getByRole("button", { name: "Check suitability" }).click();
    await expect(report).toContainText("Not suitable");
    await expect(line("not_met").filter({ hasText: /layout/i })).toHaveCount(1);
    await expect(line("met").filter({ hasText: /capacity/i }), "its capacity is fine").toHaveCount(1);
  });

  await test.step("facilities are not judged: that line says Not checked (109-S1, S3)", async () => {
    await expect(line("not_checked").filter({ hasText: /facilit/i })).toHaveCount(1);
  });

  await test.step("a venue with the layout and room is Suitable, with the layout line Met (109-S1)", async () => {
    await form.fill({ venueName: fits.name, capacity: fits.max_capacity, ...times });
    await coordinator.getByRole("button", { name: "Check suitability" }).click();
    await expect(report).toContainText("Suitable");
    await expect(report).not.toContainText("Not suitable");
    await expect(line("met").filter({ hasText: /layout/i })).toHaveCount(1);
  });
});
