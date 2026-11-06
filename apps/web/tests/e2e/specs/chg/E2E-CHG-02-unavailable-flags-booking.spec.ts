import { VenueAdminPage } from "../../pages/VenueAdminPage";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-105, 106 (Week 7 change 2): Venue Staff mark a venue unavailable. A booking inside the period is FLAGGED and stays
// Approved (its event is not cancelled), and its coordinator, and only that coordinator, is notified once.
const t = tc("E2E-CHG-02");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const venue = await data.venue();
  const elsewhere = await data.venue({ label: "Other venue" });
  const affected = await data.event({ coordinator: "coordinator", label: "Affected" });
  const unaffected = await data.event({ coordinator: "coordinator2", label: "Elsewhere" });
  // the first event holds the venue on 15 Nov, inside the block; the second holds a different venue the same day
  const inside = await data.booking({ event: affected, venue, requestedBy: "coordinator", day: "2031-11-15", start: "09:00", end: "17:00", status: "approved" });
  await data.booking({ event: unaffected, venue: elsewhere, requestedBy: "coordinator2", day: "2031-11-15", start: "09:00", end: "17:00", status: "approved" });

  const venueStaff = await as("venueStaff");
  const admin = new VenueAdminPage(venueStaff);

  await test.step("marking 14 Nov 08:00 to 16 Nov 18:00 unavailable says one booking is affected (106-S1)", async () => {
    await admin.open(venue.id);
    const form = await admin.markUnavailable({ startDate: "2031-11-14", startTime: "08:00", endDate: "2031-11-16", endTime: "18:00", reason: "maintenance" });
    await expect(form.getByText(/1 booking affected/)).toBeVisible();
  });

  await test.step("the booking is flagged but still Approved, and its event is not cancelled (106-S1, 105 AC)", async () => {
    const flags = await data.rest<{ kind: string; resolved_at: string | null }[]>(`venue_booking_flags?select=kind,resolved_at&booking_id=eq.${inside.id}`);
    expect(flags).toEqual([{ kind: "venue_unavailable", resolved_at: null }]);
    expect((await data.bookingsOf(affected))[0].status).toBe("approved");
    const [event] = await data.rest<{ status: string }[]>(`events?select=status&id=eq.${affected.id}`);
    expect(event.status).toBe("approved");
  });

  await test.step("only that booking's coordinator is notified, once, with the event, venue, period and reason (106-S2, S5)", async () => {
    const mine = await data.rest<{ user_id: string; message: string }[]>(`notifications?select=user_id,message&type=eq.venue_booking_flagged&venue_booking_id=eq.${inside.id}`);
    expect(mine.map((n) => n.user_id)).toEqual([await data.idOf("coordinator")]);
    expect(mine[0].message).toContain(affected.name);
    expect(mine[0].message).toContain("Maintenance");

    // nobody else heard: not the other coordinator, not the organiser
    for (const who of ["coordinator2", "organiser"] as const) {
      const others = await data.rest(`notifications?select=id&type=eq.venue_booking_flagged&user_id=eq.${await data.idOf(who)}&event_id=eq.${affected.id}`);
      expect(others, who).toEqual([]);
    }

    // and the coordinator can read it on screen
    const coordinator = await as("coordinator");
    await coordinator.goto("/notifications");
    await expect(coordinator.getByRole("listitem").filter({ hasText: affected.name }).filter({ hasText: "Maintenance" }).first()).toBeVisible();
  });
});
