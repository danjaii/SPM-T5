import { callAs } from "../../fixtures/api";
import { PRIMARY_BY_ROLE, type Persona } from "../../fixtures/accounts";
import { SERVICE_URL } from "../../fixtures/env";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";
import type { Role } from "@spm-t5/shared";

// The UI hides what a role may not do, but the services are called directly too. Each call below is something only one role
// may do, made by every other role: it must be refused with 403, change nothing, and a call with no session must get 401.
// Sources: 77-AC7, 78-AC9 (Lead), 39-S7 (venue decision), 99-AC7 / SCRUM-116 (safety decision), 98-S28 (venue bookings of an
// event), 19-S13 (equipment reservation). An unassigned coordinator is E2E-ACL-05.
const t = tc("E2E-ACL-02");

/** One persona per role except the allowed ones. */
const everyoneBut = (...allowed: Role[]): Persona[] =>
  (Object.entries(PRIMARY_BY_ROLE) as [Role, Persona][]).filter(([role]) => !allowed.includes(role)).map(([, persona]) => persona);

test(t.title, { annotation: t.annotation }, async ({ as, data, request }) => {
  const venue = await data.venue();
  const item = await data.equipment();
  const rachel = await data.idOf("coordinator");

  const unassigned = await data.event({ status: "submitted", coordinator: null, label: "Unassigned" });
  const withBooking = await data.event({ label: "With booking" }); // assigned to the coordinator
  const pending = await data.booking({ event: withBooking, venue, requestedBy: "coordinator", day: DAY, start: "10:00", end: "12:00", status: "requested" });
  const ready = await data.event({ status: "awaiting_arrangements", label: "Ready for safety" });
  await data.booking({ event: ready, venue, requestedBy: "coordinator", day: DAY, start: "14:00", end: "16:00", status: "approved" });
  for (const table of ["safety_checks", "event_status_history", "notifications"]) data.trackWhere(table, `event_id=eq.${ready.id}`);

  const { event, venue: venueService, equipment } = SERVICE_URL;
  const booking = { eventId: withBooking.id, venueId: venue.id, date: DAY, startTime: "10:00", endTime: "12:00" };
  const reservation = { eventId: withBooking.id, equipmentId: item.id, quantity: 1, date: DAY, startTime: "10:00", endTime: "11:00" };

  interface Attempt { name: string; method: "GET" | "POST"; url: string; body?: unknown; refused: Persona[]; unchanged?: () => Promise<void> }
  const attempts: Attempt[] = [
    { name: "Lead's unassigned queue (77-AC7)", method: "GET", url: `${event}/lead/queue`, refused: everyoneBut("event_coordinator_lead") },
    {
      name: "assign a coordinator (78-AC9)", method: "POST", url: `${event}/lead/events/${unassigned.id}/assign`, body: { coordinator_id: rachel },
      refused: everyoneBut("event_coordinator_lead"),
      unchanged: async () => {
        const [row] = await data.rest<{ assigned_coordinator_id: string | null }[]>(`events?select=assigned_coordinator_id&id=eq.${unassigned.id}`);
        expect(row.assigned_coordinator_id, "the event is still unassigned").toBeNull();
      },
    },
    {
      name: "approve a booking (38/39-S7)", method: "POST", url: `${venueService}/venue-bookings/${pending.id}/approve`, refused: everyoneBut("venue_staff"),
      unchanged: async () => expect(await data.bookingsOf(withBooking), "the booking is still Pending").toEqual([{ id: pending.id, status: "requested" }]),
    },
    {
      name: "reject a booking (39-S7)", method: "POST", url: `${venueService}/venue-bookings/${pending.id}/reject`, body: { reason: "Not allowed" }, refused: everyoneBut("venue_staff"),
      unchanged: async () => expect(await data.bookingsOf(withBooking)).toEqual([{ id: pending.id, status: "requested" }]),
    },
    {
      name: "record a safety decision (99-AC7)", method: "POST", url: `${event}/safety-checks/${ready.id}/decision`, body: { decision: "approved" }, refused: everyoneBut("safety_officer"),
      unchanged: async () => {
        expect(await data.rest(`safety_checks?select=id&event_id=eq.${ready.id}`), "no decision was recorded").toEqual([]);
        const [row] = await data.rest<{ status: string }[]>(`events?select=status&id=eq.${ready.id}`);
        expect(row.status).toBe("awaiting_arrangements");
      },
    },
    {
      name: "request a venue for an event (98-S26, S28)", method: "POST", url: `${venueService}/venue-bookings`, body: booking,
      refused: everyoneBut("event_coordinator"), // only the coordinator it is assigned to may (an unassigned coordinator: E2E-ACL-05)
      unchanged: async () => expect(await data.bookingsOf(withBooking), "no new booking").toHaveLength(1),
    },
    {
      name: "list an event's venue bookings (98-S27, S28)", method: "GET", url: `${venueService}/events/${withBooking.id}/venue-bookings`,
      refused: everyoneBut("event_coordinator"),
    },
    {
      name: "reserve equipment (19-S13)", method: "POST", url: `${equipment}/equipment-reservations`, body: reservation, refused: everyoneBut("technical_support_staff"),
      unchanged: async () => expect(await data.reservationsOf(item), "nothing was reserved").toEqual([]),
    },
  ];

  for (const attempt of attempts) {
    await test.step(attempt.name, async () => {
      for (const who of attempt.refused) {
        const page = await as(who);
        const { status } = await callAs(page, attempt.method, attempt.url, attempt.body);
        expect(status, `${who}: ${attempt.name}`).toBe(403);
      }
      // no session at all
      const anonymous = await callAs(request, attempt.method, attempt.url, attempt.body);
      expect(anonymous.status, `no session: ${attempt.name}`).toBe(401);

      await attempt.unchanged?.();
    });
  }

  // positive control: the refusals above are about the caller, not a broken setup or URL
  await test.step("the assigned coordinator is allowed to list their event's bookings", async () => {
    const { status } = await callAs(await as("coordinator"), "GET", `${venueService}/events/${withBooking.id}/venue-bookings`);
    expect(status).toBe(200);
  });
});
