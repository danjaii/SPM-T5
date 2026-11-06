import { SafetyCheckPages } from "../../pages/SafetyCheckPages";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-99/AC4 + AC8, SCRUM-100 and SCRUM-171 (Week 7 change 6): "Request changes" sends the event back to Planning so the
// coordinator can adjust it, tells the coordinator and the organiser, and records who decided, when, and why.
const t = tc("E2E-SAFE-02");

const COMMENTS = "The east exit is blocked by the stage. Move the stage or add a second exit.";

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  // an event that is waiting for the safety check: Awaiting Arrangements, with its only venue booking approved (the
  // readiness rule is_ready_for_safety_check)
  const venue = await data.venue();
  const event = await data.event({ status: "awaiting_arrangements" });
  // rows the decision will create go before the event itself on cleanup
  for (const table of ["safety_checks", "event_status_history", "notifications"]) data.trackWhere(table, `event_id=eq.${event.id}`);
  await data.booking({ event, venue, requestedBy: "coordinator", day: DAY, start: "10:00", end: "12:00", status: "approved" });
  const officer = await data.idOf("safety");

  const safetyPage = await as("safety");
  const safety = new SafetyCheckPages(safetyPage);

  await test.step("the event is in the Safety Officer's queue", async () => {
    await expect(await safety.queueLink(event.name)).toBeVisible();
  });

  await test.step("the officer requests changes with a comment", async () => {
    await safety.openFromQueue(event.name);
    await safety.decide("Request changes", COMMENTS);
    await expect(safety.recorded).toContainText("Changes Requested");
    await expect(safetyPage.getByText(COMMENTS)).toBeVisible();
  });

  await test.step("the event is back in Planning and the decision is recorded with who, when and why (AC8)", async () => {
    const [stored] = await data.rest<{ status: string }[]>(`events?select=status&id=eq.${event.id}`);
    expect(stored.status).toBe("planning");

    const [check] = await data.rest<{ decision: string; reason: string; decided_by: string; decided_at: string }[]>(
      `safety_checks?select=decision,reason,decided_by,decided_at&event_id=eq.${event.id}`,
    );
    expect(check.decision).toBe("changes_requested");
    expect(check.reason).toBe(COMMENTS);
    expect(check.decided_by).toBe(officer);
    expect(Date.now() - Date.parse(check.decided_at)).toBeLessThan(5 * 60_000); // recorded just now

    const history = await data.rest<{ old_status: string; new_status: string }[]>(
      `event_status_history?select=old_status,new_status&event_id=eq.${event.id}&new_status=eq.planning`,
    );
    expect(history).toEqual([{ old_status: "awaiting_arrangements", new_status: "planning" }]);
  });

  await test.step("it has left the safety queue", async () => {
    await expect(await safety.queueLink(event.name)).toHaveCount(0);
  });

  await test.step("the coordinator is told, with the comment, and sees the event in Planning", async () => {
    const coordinator = await as("coordinator");
    await coordinator.goto("/notifications");
    const row = coordinator.getByRole("listitem").filter({ hasText: "Safety check decision" }).filter({ hasText: event.name });
    await expect(row).toContainText(COMMENTS);

    await coordinator.goto(`/events/${event.id}`);
    // the status stepper marks the current step; "Planning" is always printed as one of its steps, so look at the marked one
    await expect(coordinator.locator('[aria-current="step"]')).toContainText("Planning");
  });
});
