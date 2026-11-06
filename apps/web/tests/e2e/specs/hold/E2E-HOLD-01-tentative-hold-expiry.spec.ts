import { DAY } from "../../fixtures/scenarios";
import { BookingDecisionPage } from "../../pages/BookingPages";
import { VenueRequestPage } from "../../pages/VenueRequestPage";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-97 and SCRUM-108 (docs/specs/SCRUM-97-108-tentative-hold-expiry.md), Week 7 change 4: a Pending venue request is a tentative hold.
// Venue Staff set its expiry; the coordinator is warned; while it is live nobody else can have the slot; once it lapses the slot is free
// for another event, the lapsed hold cannot be approved (it is never treated as confirmed), and the coordinator is told it expired.
// Expiry is derived from the time (decision D3), so the test moves the stored expiry into the past with the service key: the screen
// refuses a past expiry (D8), and waiting for a real one would make the suite slow and time-dependent.
const t = tc("E2E-HOLD-01");

/** A Singapore-time datetime-local value `hours` from now, as the Venue Staff expiry box takes it. */
const inHours = (hours: number) => new Date(Date.now() + 8 * 3600e3 + hours * 3600e3).toISOString().slice(0, 16);

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const venue = await data.venue({ label: "Held venue" });
  const holder = await data.event({ coordinator: "coordinator", label: "Holder", day: DAY, start: "09:00", end: "17:00" });
  const other = await data.event({ coordinator: "coordinator2", label: "Other", day: DAY, start: "09:00", end: "17:00" });
  const hold = await data.booking({ event: holder, venue, requestedBy: "coordinator", day: DAY, start: "10:00", end: "12:00", status: "requested" });

  const staff = await as("venueStaff");
  const rachel = await as("coordinator");
  const marcus = await as("coordinator2");
  const decision = new BookingDecisionPage(staff);
  const request = new VenueRequestPage(marcus);
  const askForSlot = async () => {
    await request.open(other.id);
    await request.fill({ venueName: venue.name, capacity: venue.max_capacity, date: DAY, start: "10:00", end: "12:00" });
    await request.submit();
  };

  await test.step("Venue Staff set an expiry two hours from now and the coordinator is told (SCRUM-97)", async () => {
    await decision.open(hold.id);
    await expect(staff.getByRole("heading", { name: "Hold expiry" })).toBeVisible();
    await staff.getByLabel("Hold expires").fill(inHours(2));
    await staff.getByRole("button", { name: "Save expiry" }).click();
    await expect(staff.getByRole("status").filter({ hasText: "Expiry saved. The event's coordinator has been told." })).toBeVisible();
    const [row] = await data.rest<{ hold_expires_at: string | null }[]>(`venue_bookings?select=hold_expires_at&id=eq.${hold.id}`);
    expect(row.hold_expires_at, "the expiry is stored").not.toBeNull();
  });

  await test.step("inside the warning window the holder's coordinator sees a warning, and the other coordinator sees none (108-AC2, AC7)", async () => {
    await rachel.goto(`/venue-bookings/${hold.id}`);
    await expect(rachel.getByTestId("hold-warning")).toContainText("Hold expires in");
    await marcus.goto("/venue-bookings");
    await expect(marcus.getByTestId("hold-warning"), "Marcus has no part in this hold").toHaveCount(0);
  });

  await test.step("while the hold is live the slot is not available to another event (SCRUM-97)", async () => {
    await askForSlot();
    await expect(request.refusal).toContainText(`${venue.name} is tentatively held from 10:00 to 12:00`);
    expect(await data.bookingsOf(other), "no booking was created").toEqual([]);
  });

  await test.step("the hold lapses: the coordinator is told it expired, and no longer sees the venue as reserved (108-AC5)", async () => {
    await data.rest(`venue_bookings?id=eq.${hold.id}`, { method: "PATCH", body: JSON.stringify({ hold_expires_at: new Date(Date.now() - 60_000).toISOString() }) });
    // the periodic check in notification-service writes this once per hold and expiry time; run it now with the real time
    await data.rest("rpc/notify_hold_expiries", { method: "POST", body: JSON.stringify({ p_now: new Date().toISOString() }) });
    await rachel.goto(`/venue-bookings/${hold.id}`);
    await expect(rachel.getByTestId("hold-expired")).toContainText("Hold expired, venue no longer reserved");
    await rachel.goto("/notifications");
    await expect(rachel.getByRole("listitem").filter({ hasText: holder.name }).filter({ hasText: "Hold expired" }).first()).toBeVisible();
    const told = await data.rest<{ user_id: string }[]>(`notifications?select=user_id&venue_booking_id=eq.${hold.id}&type=eq.hold_expired`);
    expect(told.map((n) => n.user_id), "once, to the holder's coordinator only").toEqual([await data.idOf("coordinator")]);
  });

  await test.step("an expired hold is never treated as confirmed: it cannot be approved, whoever else wants the slot", async () => {
    await decision.open(hold.id);
    await staff.getByRole("button", { name: "Approve request" }).click();
    await staff.getByRole("dialog").getByRole("button", { name: "Yes, approve" }).click();
    await expect(staff.getByText("This hold has expired and the venue is no longer reserved. A new venue request is needed.")).toBeVisible();
    expect((await data.bookingsOf(holder))[0].status, "it is still Pending, never Approved").toBe("requested");
  });
  await test.step("the slot is free again: another event's request is accepted (Week 9 Q26)", async () => {
    await askForSlot();
    await expect(marcus).toHaveURL(/\/venue-bookings\/[0-9a-f-]+$/);
    expect(await data.bookingsOf(other)).toHaveLength(1);
  });

});
