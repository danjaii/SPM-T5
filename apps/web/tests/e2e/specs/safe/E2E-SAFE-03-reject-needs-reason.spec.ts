import { SafetyCheckPages } from "../../pages/SafetyCheckPages";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-99/AC6 (failure path): rejecting needs a reason. Without one nothing is recorded; with one the event goes back to
// Planning and the decision shows who, what and why.
const t = tc("E2E-SAFE-03");

const REASON = "The only emergency exit is blocked by the stage.";

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const venue = await data.venue();
  const event = await data.event({ status: "awaiting_arrangements" });
  for (const table of ["safety_checks", "event_status_history", "notifications"]) data.trackWhere(table, `event_id=eq.${event.id}`);
  await data.booking({ event, venue, requestedBy: "coordinator", day: DAY, start: "10:00", end: "12:00", status: "approved" });

  const officer = await as("safety");
  const safety = new SafetyCheckPages(officer);
  const decisions = () => data.rest<{ decision: string; reason: string }[]>(`safety_checks?select=decision,reason&event_id=eq.${event.id}`);
  const status = async () => (await data.rest<{ status: string }[]>(`events?select=status&id=eq.${event.id}`))[0].status;

  await safety.openFromQueue(event.name);

  await test.step("Reject with no reason is refused and nothing is recorded", async () => {
    await safety.decide("Reject");
    await expect(officer.getByText("Give a reason for rejecting this event.")).toBeVisible();
    expect(await decisions()).toEqual([]);
    expect(await status()).toBe("awaiting_arrangements");
  });

  await test.step("Reject with a reason is recorded and the event cannot proceed (back to Planning)", async () => {
    await safety.decide("Reject", REASON);
    await expect(safety.recorded).toContainText("Safety Rejected");
    expect(await decisions()).toEqual([{ decision: "rejected", reason: REASON }]);
    expect(await status()).toBe("planning");
  });
});
