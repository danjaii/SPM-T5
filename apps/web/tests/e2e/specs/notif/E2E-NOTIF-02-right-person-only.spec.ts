import { callAs } from "../../fixtures/api";
import { SERVICE_URL } from "../../fixtures/env";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";
import type { Persona } from "../../fixtures/accounts";

// SCRUM-47 and SCRUM-172: one action sends one notification to the person it concerns, and to nobody else. In particular
// never to the person who did it (the team applies that to every criterion).
const t = tc("E2E-NOTIF-02");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const venue = await data.venue();
  // 1. an unassigned request the Lead will assign
  const toAssign = await data.event({ status: "submitted", coordinator: null, label: "To assign", submittedAt: new Date(Date.now() - 3600e3).toISOString() });
  // 2. an approved event whose Pending venue request Venue Staff will approve (the coordinator asked for it)
  const withRequest = await data.event({ label: "With request" });
  const request = await data.booking({ event: withRequest, venue, requestedBy: "coordinator", day: DAY, start: "10:00", end: "12:00", status: "requested" });

  const told = async (eventId: string, type: string) =>
    (await data.rest<{ user_id: string }[]>(`notifications?select=user_id&event_id=eq.${eventId}&type=eq.${type}`)).map((n) => n.user_id).sort();
  const ids = async (...who: Persona[]) => (await Promise.all(who.map((w) => data.idOf(w)))).sort();
  const anyFor = async (eventId: string, who: Persona) =>
    data.rest(`notifications?select=id&event_id=eq.${eventId}&user_id=eq.${await data.idOf(who)}`);

  await test.step("the Lead assigns: only the new coordinator is told, not the Lead who did it nor another coordinator (47-AC1, AC8)", async () => {
    const lead = await as("lead");
    const res = await callAs(lead, "POST", `${SERVICE_URL.event}/lead/events/${toAssign.id}/assign`, { coordinator_id: await data.idOf("coordinator") });
    expect(res.status).toBe(200);

    expect(await told(toAssign.id, "coordinator_assigned")).toEqual(await ids("coordinator"));
    for (const who of ["lead", "coordinator2", "organiser2"] as const) expect(await anyFor(toAssign.id, who), who).toEqual([]);
  });

  await test.step("Venue Staff approve: only the event's coordinator is told, not the Venue Staff who decided (172-AC2)", async () => {
    const staff = await as("venueStaff");
    const res = await callAs(staff, "POST", `${SERVICE_URL.venue}/venue-bookings/${request.id}/approve`);
    expect(res.status).toBe(200);

    expect(await told(withRequest.id, "venue_booking_approved")).toEqual(await ids("coordinator"));
    expect(await anyFor(withRequest.id, "venueStaff"), "the decider").toEqual([]);
    expect(await anyFor(withRequest.id, "coordinator2"), "another coordinator").toEqual([]);
  });
});
