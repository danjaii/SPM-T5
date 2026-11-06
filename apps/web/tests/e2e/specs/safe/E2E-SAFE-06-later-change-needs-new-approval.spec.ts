import { BookingDecisionPage } from "../../pages/BookingPages";
import { EventEditPage } from "../../pages/EventEditPage";
import { EventReviewPage } from "../../pages/ReviewPages";
import { SafetyCheckPages } from "../../pages/SafetyCheckPages";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-100/AC9 and the customer's Week 9 answer ("any post-confirmation material change requires re-reviewing affected
// arrangements and undergoing the safety check again before re-confirmation"): an important change to a Confirmed event revokes its
// Safety Approval, so after the arrangements are approved again the event waits for a new check, and cannot be confirmed without it.
const t = tc("E2E-SAFE-06");
const NEXT_DAY = "2031-11-15";

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const venue = await data.venue();
  const event = await data.event({ status: "confirmed", coordinator: "coordinator", day: DAY, start: "09:00", end: "17:00" });
  const booking = await data.booking({ event, venue, requestedBy: "coordinator", day: DAY, start: "09:00", end: "17:00", status: "approved" });
  for (const table of ["safety_checks", "event_status_history", "notifications"]) data.trackWhere(table, `event_id=eq.${event.id}`);
  await data.insert("safety_checks", { event_id: event.id, decided_by: await data.idOf("safety"), decision: "approved" });
  const statusOf = async () => (await data.rest<{ status: string }[]>(`events?select=status&id=eq.${event.id}`))[0].status;
  const revoked = async () => (await data.rest<{ revoked_at: string | null }[]>(`safety_checks?select=revoked_at&event_id=eq.${event.id}`)).map((r) => r.revoked_at);

  const coordinator = await as("coordinator");
  const review = new EventReviewPage(coordinator);

  await test.step("the date of the Confirmed event changes: it goes back to Planning and its Safety Approval is revoked (SCRUM-100/AC9)", async () => {
    const edit = new EventEditPage(coordinator);
    await edit.open(event.id);
    await coordinator.getByLabel("Date", { exact: true }).fill(NEXT_DAY);
    await coordinator.getByLabel("End date", { exact: true }).fill(NEXT_DAY);
    await edit.save();
    await edit.saveAnyway();
    await expect(coordinator).toHaveURL(new RegExp(`/events/${event.id}\\?saved=1`));
    expect(await statusOf()).toBe("planning");
    expect((await revoked())[0], "the approval is kept for the record, stamped revoked").not.toBeNull();
  });

  await test.step("Venue Staff approve the booking again, and the event waits for a new safety check", async () => {
    const decision = new BookingDecisionPage(await as("venueStaff"));
    await decision.open(booking.id);
    await decision.approve();
    await expect.poll(statusOf).toBe("awaiting_arrangements");
  });

  await test.step("the old approval does not count: confirming is refused", async () => {
    await coordinator.goto(`/events/${event.id}`);
    await review.setStatus("Confirmed");
    await expect(coordinator.getByText("This event can't move to preparation until it is Safety Approved.")).toBeVisible();
    expect(await statusOf()).toBe("awaiting_arrangements");
  });

  await test.step("the Safety Officer approves again, and then the coordinator can confirm", async () => {
    const check = new SafetyCheckPages(await as("safety"));
    await check.openFromQueue(event.name);
    await check.decide("Approve", "Re-checked after the date change.");
    await expect(check.recorded).toContainText("Safety Approved");
    await coordinator.goto(`/events/${event.id}`);
    await review.setStatus("Confirmed");
    await expect.poll(statusOf).toBe("confirmed");
  });
});
