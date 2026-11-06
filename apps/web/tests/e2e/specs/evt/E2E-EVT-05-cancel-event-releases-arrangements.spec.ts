import { callAs } from "../../fixtures/api";
import { SERVICE_URL } from "../../fixtures/env";
import { waitForHydration } from "../../fixtures/hydration";
import { sgt } from "../../fixtures/data";
import { DAY } from "../../fixtures/scenarios";
import { ChangeRequestFormPage } from "../../pages/ChangeRequestPages";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-174 (docs/specs/cancel-event.md; the customer's Week 9 answers): cancelling needs a reason; the event's venue bookings and
// equipment are released so others can have them; its open change request is closed; the organiser and the people still registered
// are told, and nobody else; and a cancelled event stays cancelled.
const t = tc("E2E-EVT-05");
const REASON = "Organiser withdrew the event";

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const venue = await data.venue({ label: "Released venue" });
  const item = await data.equipment({ totalQuantity: 5 });
  const event = await data.event({ status: "planning", coordinator: "coordinator", day: DAY, start: "09:00", end: "17:00", label: "To cancel" });
  const booking = await data.booking({ event, venue, requestedBy: "coordinator", day: DAY, start: "09:00", end: "17:00", status: "approved" });
  await data.insert("equipment_reservations", {
    event_id: event.id, equipment_id: item.id, quantity_requested: 2, quantity_reserved: 2, status: "reserved",
    start_datetime: sgt(DAY, "09:00"), end_datetime: sgt(DAY, "17:00"),
  });
  // one registered, one waiting for the organiser, one who withdrew: the first two are told, the third is not (174-S9)
  const details = (email: string) => ({ name: "E2E", email, phone: "+65 9123 4567" });
  for (const [who, status, email] of [["attendee", "registered", "alicia.fernandez@example.com"], ["attendee2", "withdrawn", "bryan.ho@example.com"]] as const) {
    await data.insert("event_registrations", { event_id: event.id, attendee_id: await data.idOf(who), status, registration_details: details(email) });
  }
  await data.insert("event_registrations", { event_id: event.id, attendee_id: await data.userId("chen.wei.jie@example.com"), status: "waitlisted", registration_details: details("chen.wei.jie@example.com") });

  const organiser = await as("organiser");
  const coordinator = await as("coordinator");
  const statusOf = async () => (await data.rest<{ status: string; cancelled_at: string | null }[]>(`events?select=status,cancelled_at&id=eq.${event.id}`))[0];

  await test.step("an organiser's change request is waiting for the coordinator", async () => {
    const form = new ChangeRequestFormPage(organiser);
    await form.open(event.id);
    await form.requestAttendance(60);
    await expect(organiser.getByText(/submitted for approval/)).toBeVisible();
  });

  await test.step("choosing Cancelled asks for a reason: the browser refuses an empty Save, and so does the service (174-S1, S13)", async () => {
    await coordinator.goto(`/events/${event.id}`);
    await waitForHydration(coordinator, "#new-status");
    await coordinator.getByLabel("New status").selectOption({ label: "Cancelled" });
    const reason = coordinator.getByLabel("Reason (required)");
    await expect(reason).toBeVisible();
    await coordinator.getByRole("button", { name: "Save", exact: true }).click();
    // the box is a required field, so the browser itself stops an empty Save before the page's own code runs (174-S13)
    expect(await reason.evaluate((el) => (el as HTMLTextAreaElement).validity.valueMissing), "the reason box is marked missing").toBe(true);
    expect((await statusOf()).status).toBe("planning");
    // and the service refuses a cancellation with no reason, however the call is made (174-S1)
    const refused = await callAs(coordinator, "PATCH", `${SERVICE_URL.event}/events/${event.id}/status`, { status: "cancelled" });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain("A reason is required to cancel an event.");
    expect((await statusOf()).status, "still planning").toBe("planning");
  });

  await test.step("with a reason it is cancelled, and the history keeps the reason (174-S2)", async () => {
    await coordinator.getByLabel("Reason (required)").fill(REASON);
    await coordinator.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(async () => (await statusOf()).status).toBe("cancelled");
    expect((await statusOf()).cancelled_at, "cancelled_at is set").not.toBeNull();
    const history = await data.rest<{ new_status: string; reason: string }[]>(`event_status_history?select=new_status,reason&event_id=eq.${event.id}&new_status=eq.cancelled`);
    expect(history).toEqual([{ new_status: "cancelled", reason: REASON }]);
  });

  await test.step("its venue booking and equipment are released (174-S3, S5)", async () => {
    const [row] = await data.rest<{ status: string; cancellation_reason: string }[]>(`venue_bookings?select=status,cancellation_reason&id=eq.${booking.id}`);
    expect(row).toEqual({ status: "cancelled", cancellation_reason: "The event was cancelled." });
    expect((await data.reservationsOf(item)).map((r) => r.status), "the units are free again").toEqual(["cancelled"]);
  });

  await test.step("the open change request is closed automatically (174-S7)", async () => {
    const rows = await data.rest<{ status: string; review_notes: string }[]>(`event_change_requests?select=status,review_notes&event_id=eq.${event.id}`);
    expect(rows).toEqual([{ status: "rejected", review_notes: "Closed automatically: the event was cancelled." }]);
  });

  await test.step("the organiser and the two active attendees are told once; the withdrawn attendee and the coordinator are not (174-S9)", async () => {
    const told = (await data.rest<{ user_id: string }[]>(`notifications?select=user_id&event_id=eq.${event.id}&type=eq.event_cancelled`)).map((n) => n.user_id).sort();
    const expected = (await Promise.all([data.idOf("organiser"), data.idOf("attendee"), data.userId("chen.wei.jie@example.com")])).sort();
    expect(told).toEqual(expected);
  });

  await test.step("a cancelled event stays cancelled: its status can no longer change (174-S10)", async () => {
    await coordinator.goto(`/events/${event.id}`);
    await expect(coordinator.getByText("This event was cancelled, so its status can no longer change.")).toBeVisible();
  });
});
