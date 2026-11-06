import { VenueAdminPage } from "../../pages/VenueAdminPage";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-185/AC1 (docs/specs/venue-block-reverts-event.md) and AC2 (docs/specs/venue-block-lifting.md), Week 7 change 2. Venue Staff
// block the venue of a Confirmed event: the event goes back to Planning, kept and not cancelled, with a history row, and its
// coordinator is told, with an action to take. Venue Staff then lift the block: the flag on the booking is cleared, the block is
// gone and the coordinator is told that the booking is no longer affected. The replacement-confirmed notice (AC3) is E2E-NOTIF-03.
const t = tc("E2E-CHG-07");
const PERIOD = "14 Nov 08:00 to 16 Nov 18:00"; // DAY is 14 Nov 2031

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const venue = await data.venue({ capacity: 200, label: "Blocked venue" });
  // a Confirmed event with an Approved booking on 14 Nov, 09:00 to 17:00 Singapore time, and its Safety Approval
  const event = await data.event({ status: "confirmed", coordinator: "coordinator", day: DAY, start: "09:00", end: "17:00", label: "Confirmed summit" });
  const booking = await data.booking({ event, venue, requestedBy: "coordinator", day: DAY, start: "09:00", end: "17:00", status: "approved" });
  await data.insert("safety_checks", { event_id: event.id, decided_by: await data.idOf("safety"), decision: "approved" });
  const statusOf = async () => (await data.rest<{ status: string }[]>(`events?select=status&id=eq.${event.id}`))[0].status;

  const staff = await as("venueStaff");
  const coordinator = await as("coordinator");
  const admin = new VenueAdminPage(staff);

  await test.step("185-S1: before the block the event is Confirmed", async () => {
    await coordinator.goto(`/events/${event.id}`);
    await expect(coordinator.getByRole("heading", { name: event.name }).first()).toBeVisible();
    await expect(coordinator.getByText("Confirmed", { exact: true }).first()).toBeVisible();
  });

  await test.step("185-S1: Venue Staff block the venue over the booking, are told one booking is affected, and the event returns to Planning", async () => {
    await admin.open(venue.id);
    const form = await admin.markUnavailable({ startDate: "2031-11-14", startTime: "08:00", endDate: "2031-11-16", endTime: "18:00", reason: "maintenance" });
    await expect(form.getByText(/1 booking affected/)).toBeVisible();
    await expect.poll(statusOf).toBe("planning");
    expect(await data.rest<{ status: string }[]>(`venue_bookings?select=status&id=eq.${booking.id}`), "the booking itself is kept").toEqual([{ status: "approved" }]);
  });

  await test.step("185-S1: the history says confirmed to planning, and the coordinator is told with the action to take", async () => {
    const history = await data.rest<{ old_status: string; new_status: string }[]>(`event_status_history?select=old_status,new_status&event_id=eq.${event.id}`);
    expect(history).toEqual([{ old_status: "confirmed", new_status: "planning" }]);
    await coordinator.goto("/notifications");
    const row = coordinator.getByRole("listitem").filter({ hasText: event.name }).filter({ hasText: "Event returned to Planning" });
    await expect(row).toContainText(`${venue.name} is unavailable from ${PERIOD} (Maintenance), so the event has been returned to Planning.`);
    await expect(row).toContainText("Action needed");
  });

  await test.step("185-S2c: a coordinator sees the block on the venue page and has no way to lift it", async () => {
    await coordinator.goto(`/venues/${venue.id}`);
    await expect(coordinator.getByText(`${PERIOD}, Maintenance`)).toBeVisible();
    await expect(coordinator.getByRole("button", { name: /^Lift block/ })).toHaveCount(0);
  });

  await test.step("185-S2: Venue Staff are asked to confirm, and keeping the block changes nothing", async () => {
    await admin.open(venue.id);
    await staff.getByRole("button", { name: `Lift block ${PERIOD}` }).click();
    const confirm = staff.getByRole("alertdialog", { name: "Confirm lifting this block" });
    await expect(confirm).toContainText("Coordinators with affected bookings will be told.");
    await confirm.getByRole("button", { name: "Keep block" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(staff.getByText(`${PERIOD}, Maintenance`)).toBeVisible();
    expect(await data.rest<unknown[]>(`venue_booking_flags?select=id&booking_id=eq.${booking.id}&resolved_at=is.null`)).toHaveLength(1);
  });

  await test.step("185-S2: Venue Staff lift the block; it disappears, the flag is cleared and the coordinator is told", async () => {
    await staff.getByRole("button", { name: `Lift block ${PERIOD}` }).click();
    await staff.getByRole("button", { name: "Yes, lift block" }).click();
    await expect(staff.getByText("No upcoming unavailable periods.")).toBeVisible();
    await expect(staff.getByText("Unavailable period lifted. 1 coordinator has been notified.")).toBeVisible();
    expect(await data.rest<unknown[]>(`venue_booking_flags?select=id&booking_id=eq.${booking.id}`), "no flag is left").toHaveLength(0);
    expect(await statusOf(), "lifting the block does not undo the return to Planning").toBe("planning");

    await coordinator.goto("/notifications");
    const row = coordinator.getByRole("listitem").filter({ hasText: event.name }).filter({ hasText: "Venue available again" });
    await expect(row).toContainText(`the unavailable period at ${venue.name} (${PERIOD}, Maintenance) has been lifted`);
    await expect(row).toContainText("is no longer affected by it.");
  });
});
