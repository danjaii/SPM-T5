import { SafetyCheckPages } from "../../pages/SafetyCheckPages";
import { EventReviewPage } from "../../pages/ReviewPages";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-99/AC5 and AC8: an Approve records the officer, time and comments; only then can the coordinator confirm the event, and
// the event shows its safety approval.
const t = tc("E2E-SAFE-05");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const venue = await data.venue();
  const event = await data.event({ status: "awaiting_arrangements" });
  for (const table of ["safety_checks", "event_status_history", "notifications"]) data.trackWhere(table, `event_id=eq.${event.id}`);
  await data.booking({ event, venue, requestedBy: "coordinator", day: DAY, start: "10:00", end: "12:00", status: "approved" });

  const officer = await as("safety");
  const coordinator = await as("coordinator");
  const safety = new SafetyCheckPages(officer);
  const status = async () => (await data.rest<{ status: string }[]>(`events?select=status&id=eq.${event.id}`))[0].status;

  await test.step("the Safety Officer approves with a comment (AC5, AC8)", async () => {
    await safety.openFromQueue(event.name);
    await safety.decide("Approve", "All exits and capacity checked.");
    await expect(safety.recorded).toContainText("Safety Approved");
    const [row] = await data.rest<{ decision: string; reason: string; decided_by: string }[]>(`safety_checks?select=decision,reason,decided_by&event_id=eq.${event.id}`);
    expect(row).toEqual({ decision: "approved", reason: "All exits and capacity checked.", decided_by: await data.idOf("safety") });
    expect(await status(), "approving does not itself confirm").toBe("awaiting_arrangements");
  });

  await test.step("the coordinator can now confirm it", async () => {
    await coordinator.goto(`/events/${event.id}`);
    await new EventReviewPage(coordinator).setStatus("Confirmed");
    await expect.poll(status).toBe("confirmed");
  });

  await test.step("the event's Safety tab shows the approval", async () => {
    await coordinator.goto(`/events/${event.id}?tab=safety`);
    await expect(coordinator.getByText("Safety Approved").first()).toBeVisible();
  });
});
