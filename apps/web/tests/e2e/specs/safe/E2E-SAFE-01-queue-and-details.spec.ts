import { SafetyCheckPages } from "../../pages/SafetyCheckPages";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-99/AC1 to AC3 (Week 7 change 6): the Safety Officer's queue holds exactly the events whose venue and technical
// arrangements are complete, and opening one shows what the check needs: attendance against capacity, emergency access,
// accessibility and the venue's restrictions.
const t = tc("E2E-SAFE-01");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const venue = await data.venue({
    capacity: 100, accessible: true,
    emergencyAccess: "Two fire exits on the north side, assembly point in the car park.",
    restrictions: "No open flames and no amplified music after 22:00.",
  });
  const ready = await data.event({ status: "awaiting_arrangements", attendance: 80, label: "Ready" });
  await data.booking({ event: ready, venue, requestedBy: "coordinator", day: DAY, start: "10:00", end: "12:00", status: "approved", attendance: 80 });
  // same status, but its only venue request is still waiting for Venue Staff: the arrangements are not complete
  const notReady = await data.event({ status: "awaiting_arrangements", label: "Not ready" });
  await data.booking({ event: notReady, venue, requestedBy: "coordinator", day: DAY, start: "14:00", end: "16:00", status: "requested" });

  const officer = await as("safety");
  const safety = new SafetyCheckPages(officer);

  await test.step("the complete event is in the queue and the incomplete one is not (99-AC1, AC2)", async () => {
    await expect(await safety.queueLink(ready.name)).toBeVisible();
    await expect(await safety.queueLink(notReady.name)).toHaveCount(0);
  });

  await test.step("opening it shows the information the check needs (99-AC3)", async () => {
    await safety.openFromQueue(ready.name);
    const page = officer.getByRole("main");
    await expect(page).toContainText("Expected attendance: 80");
    await expect(page).toContainText(`${venue.name}: holds 100`);
    await expect(page).toContainText("Two fire exits on the north side, assembly point in the car park.");
    await expect(page).toContainText("Step-free access.");
    await expect(page).toContainText("No open flames and no amplified music after 22:00.");
  });
});
