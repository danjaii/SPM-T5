import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-99/AC7 (access control): nobody can move an event to Confirmed ("preparation") until the latest safety decision is
// Approve; the database refuses it (SC001) and the coordinator is told why. Nothing changes.
const t = tc("E2E-SAFE-04");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const venue = await data.venue();
  const event = await data.event({ status: "awaiting_arrangements" });
  await data.booking({ event, venue, requestedBy: "coordinator", day: DAY, start: "10:00", end: "12:00", status: "approved" });

  const coordinator = await as("coordinator");
  const status = async () => (await data.rest<{ status: string }[]>(`events?select=status&id=eq.${event.id}`))[0].status;

  await coordinator.goto(`/events/${event.id}`);
  await coordinator.getByLabel("New status").selectOption({ label: "Confirmed" });
  await coordinator.getByRole("button", { name: "Save", exact: true }).click();

  await expect(coordinator.getByText("This event can't move to preparation until it is Safety Approved."), "the coordinator is told why").toBeVisible();
  expect(await status(), "the event is not Confirmed").toBe("awaiting_arrangements");
  expect(await data.rest(`safety_checks?select=id&event_id=eq.${event.id}`), "and no decision was made").toEqual([]);
});
