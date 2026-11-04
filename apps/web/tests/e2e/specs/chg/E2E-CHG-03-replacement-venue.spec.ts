import { callAs } from "../../fixtures/api";
import { SERVICE_URL } from "../../fixtures/env";
import { BookingDecisionPage } from "../../pages/BookingPages";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-107 (Week 7 change 2): a booking flagged by an unavailable period can be replaced. Find replacement lists only venues
// that are free, big enough and not the original; a replacement is a new Pending request; if Venue Staff reject it the original
// stays flagged and can be replaced again; once one is approved the original reads "Replaced by" it.
const t = tc("E2E-CHG-03");

const OPEN: [string, string] = ["07:00", "23:00"];

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const original = await data.venue({ label: "Original", hours: OPEN });
  const lotus = await data.venue({ label: "Lotus", hours: OPEN });
  const maple = await data.venue({ label: "Maple", hours: OPEN });
  const tooSmall = await data.venue({ label: "Too small", capacity: 10, hours: OPEN }); // fewer seats than the 50 expected
  const busy = await data.venue({ label: "Busy", hours: OPEN });

  const event = await data.event({ attendance: 50 });
  const other = await data.event({ coordinator: "coordinator2", label: "Other event" });
  const DAY = "2031-11-15";
  const booking = await data.booking({ event, venue: original, requestedBy: "coordinator", day: DAY, start: "09:00", end: "17:00", status: "approved" });
  await data.booking({ event: other, venue: busy, requestedBy: "coordinator2", day: DAY, start: "09:00", end: "17:00", status: "approved" }); // taken

  const venueStaff = await as("venueStaff");
  const coordinator = await as("coordinator");
  const flagOpen = async () =>
    (await data.rest<{ id: string }[]>(`venue_booking_flags?select=id&booking_id=eq.${booking.id}&kind=eq.venue_unavailable&resolved_at=is.null`)).length;

  // the same call the page makes: Venue Staff mark the original venue unavailable 14-16 Nov, which flags the booking
  const marked = await callAs(venueStaff, "POST", `${SERVICE_URL.venue}/venues/${original.id}/unavailability`, {
    startDate: "2031-11-14", startTime: "08:00", endDate: "2031-11-16", endTime: "18:00", reason: "maintenance",
  });
  expect(marked.status, "the block was saved").toBe(201);
  expect(await flagOpen(), "the booking is flagged").toBe(1);

  const replace = async (venueName: string) => {
    await coordinator.goto(`/venue-bookings/${booking.id}`);
    await coordinator.getByRole("link", { name: "Find replacement" }).click();
    await expect(coordinator.getByRole("heading", { name: "Find a replacement venue" })).toBeVisible();
    await coordinator.getByRole("button", { name: `Request ${venueName}` }).click();
    await expect(coordinator).toHaveURL(/\/venue-bookings\/[0-9a-f-]+$/);
    return coordinator.url().split("/").pop()!;
  };

  await test.step("Find replacement lists only free, big enough venues, never the original (107-S1)", async () => {
    await coordinator.goto(`/venue-bookings/${booking.id}`);
    await expect(coordinator.getByLabel("Flags")).toBeVisible();
    await coordinator.getByRole("link", { name: "Find replacement" }).click();
    await expect(coordinator.getByRole("heading", { name: "Find a replacement venue" })).toBeVisible();
    for (const v of [lotus, maple]) await expect(coordinator.getByRole("cell", { name: v.name, exact: true })).toBeVisible();
    for (const v of [original, tooSmall, busy]) await expect(coordinator.getByRole("cell", { name: v.name, exact: true }), v.name).toHaveCount(0);
  });

  await test.step("a replacement that Venue Staff reject leaves the original flagged and replaceable (107-S4)", async () => {
    const rejected = await replace(maple.name);
    const decision = new BookingDecisionPage(venueStaff);
    await decision.open(rejected);
    await decision.reject("Maple is booked out that day.");
    await expect.poll(async () => (await data.bookingsOf(event)).find((b) => b.id === rejected)?.status).toBe("rejected");

    expect((await data.bookingsOf(event)).find((b) => b.id === booking.id)?.status, "the original is untouched").toBe("approved");
    expect(await flagOpen(), "and still flagged").toBe(1);

    await coordinator.goto(`/venue-bookings/${booking.id}`);
    await coordinator.getByRole("link", { name: "Find replacement" }).click();
    await expect(coordinator.getByRole("cell", { name: maple.name, exact: true }), "the rejected venue and period is not offered again").toHaveCount(0);
    await expect(coordinator.getByRole("cell", { name: lotus.name, exact: true })).toBeVisible();
  });

  await test.step("a replacement that Venue Staff approve takes over: the original reads Replaced (107-S2, S3)", async () => {
    const accepted = await replace(lotus.name);
    const rows = await data.rest<{ status: string; venue_id: string; amends_booking_id: string }[]>(`venue_bookings?select=status,venue_id,amends_booking_id&id=eq.${accepted}`);
    expect(rows[0]).toMatchObject({ status: "requested", venue_id: lotus.id, amends_booking_id: booking.id });

    const decision = new BookingDecisionPage(venueStaff);
    await decision.open(accepted);
    await decision.approve();
    await expect.poll(async () => (await data.bookingsOf(event)).find((b) => b.id === booking.id)?.status).toBe("replaced");

    const [orig] = await data.rest<{ replaced_by_booking_id: string }[]>(`venue_bookings?select=replaced_by_booking_id&id=eq.${booking.id}`);
    expect(orig.replaced_by_booking_id).toBe(accepted);
    expect(await flagOpen(), "its flag is resolved").toBe(0);

    await coordinator.goto(`/venue-bookings/${booking.id}`);
    await expect(coordinator.getByText(new RegExp(`Replaced by ${lotus.name}`))).toBeVisible();
  });
});
