import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateRegistrationForm } from "@spm-t5/shared";
import type { SupabaseDeps } from "../supabase";
import { requireSession, type SessionUser } from "../middlewares/session";
import { toUpcomingEvent, type PublicEventRow } from "../services/upcomingEvents";
import {
  ALREADY_REGISTERED,
  registrationRefusal,
  toEventRegistration,
  toMyRegistration,
  withdrawalRefusal,
  type EventRegistrationRow,
  type MyRegistrationRow,
} from "../services/registrations";

const EVENT_NOT_FOUND = { error: "Event not found." };

/**
 * The event as attendees see it, from the same list_public_events() the List of events uses (SCRUM-71).
 * Undefined when it isn't listed for attendees (no such id, or not a public event): attendees can't tell
 * the difference, so they can't discover private events.
 */
async function findPublicEvent(db: SupabaseClient, eventId: string): Promise<PublicEventRow | undefined> {
  const { data } = await db.rpc("list_public_events");
  return ((data ?? []) as PublicEventRow[]).find((row) => row.id === eventId);
}

/** SCRUM-83: an attendee registers for an upcoming event. */
export function registrationRoutes(deps: SupabaseDeps) {
  const router = Router();

  // SCRUM-83/AC15: the attendee's own registrations for "My registrations", earlier ones included (AC6: history)
  router.get("/my-registrations", requireSession(deps), async (_req, res) => {
    const { id: attendeeId, token } = res.locals.user as SessionUser;
    const db = deps.forUser(token);
    const { data, error } = await db
      .from("event_registrations")
      .select("id, status, registered_at, event:events(id, name, status, preferred_start_datetime, preferred_end_datetime)")
      .eq("attendee_id", attendeeId);
    // An empty list must mean there are none, so a failed call is an error, not [] (as in SCRUM-71/AC11)
    if (error) return res.status(500).json({ error: "We couldn't load your registrations. Please try again." });

    // SCRUM-72/AC4: each event's location comes from list_public_events(), as on the List of events (SCRUM-71/AC3):
    // RLS doesn't let an attendee read venue bookings, and this function shows them the venue of a public event
    const { data: publicEvents } = await db.rpc("list_public_events");
    const publicEventsById = new Map(((publicEvents ?? []) as PublicEventRow[]).map((e) => [e.id, e] as const));

    // SCRUM-72/AC1: upcoming events only, so one that has started is left out (the same rule as SCRUM-71/AC2)
    const now = new Date();
    res.json(
      ((data ?? []) as unknown as MyRegistrationRow[])
        .map((row) => toMyRegistration(row, publicEventsById, now))
        .filter((r) => r.event.start_at !== null && new Date(r.event.start_at) > now),
    );
  });

  // SCRUM-73: the attendee withdraws one of their registrations
  router.post("/my-registrations/:id/withdraw", requireSession(deps), async (req, res) => {
    const { id: attendeeId, token } = res.locals.user as SessionUser;
    const db = deps.forUser(token);

    // SCRUM-73/AC1: only the attendee's own registration; anyone else's is "not found", so ids can't be probed
    const { data: registration } = await db
      .from("event_registrations")
      .select("id, status, event:events(id, name, status, preferred_start_datetime, preferred_end_datetime)")
      .eq("id", req.params.id)
      .eq("attendee_id", attendeeId)
      .maybeSingle();
    if (!registration) return res.status(404).json({ error: "Registration not found." });

    // SCRUM-73/AC2, AC5: Pending or Confirmed only, and not once the event has started or been cancelled
    const row = registration as unknown as MyRegistrationRow;
    const refusal = withdrawalRefusal(row.status, Array.isArray(row.event) ? row.event[0] : row.event, new Date());
    if (refusal) return res.status(409).json({ error: refusal });

    // SCRUM-73/AC6: the status becomes Withdrawn, and withdrawn_at records when
    const { data: withdrawn } = await db
      .from("event_registrations")
      .update({ status: "withdrawn", withdrawn_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .select("id");
    // SCRUM-73/AC6: RLS refuses an update by changing no row (not with an error), so check one was changed
    if (!withdrawn?.length) return res.status(409).json({ error: "This registration can no longer be withdrawn." });
    res.json({ status: "withdrawn" });
  });

  // SCRUM-83/AC7: what the registration form shows about the event: name, date and time, and location
  router.get("/:id/registration-form", requireSession(deps), async (req, res) => {
    const { id: attendeeId, token } = res.locals.user as SessionUser;
    const db = deps.forUser(token);
    const event = await findPublicEvent(db, String(req.params.id));
    if (!event) return res.status(404).json(EVENT_NOT_FOUND);

    // SCRUM-83/AC8: the form starts with the attendee's own name, email and contact number, under the keys it submits
    const { data: profile } = await db.from("users").select("full_name, email, phone").eq("id", attendeeId).maybeSingle();
    // SCRUM-83/AC9: no contact number in the profile means an empty field, not "null"
    const prefill = { name: profile?.full_name, email: profile?.email, phone: profile?.phone ?? "" };

    res.json({ event: toUpcomingEvent(event, new Date()), prefill });
  });

  // SCRUM-83/AC15: the event's registrations, for the page organisers and coordinators see.
  // Who may read them is RLS's job (supabase/migrations/11_event_registrations.sql), not this route's.
  router.get("/:id/registrations", requireSession(deps), async (req, res) => {
    const { token } = res.locals.user as SessionUser;
    const { data, error } = await deps
      .forUser(token)
      .from("event_registrations")
      .select("id, status, registered_at, registration_details")
      .eq("event_id", req.params.id);
    // An empty list must mean nobody has registered, so a failed call is an error, not []
    if (error) return res.status(500).json({ error: "We couldn't load this event's registrations. Please try again." });

    res.json(((data ?? []) as EventRegistrationRow[]).map(toEventRegistration));
  });

  router.post("/:id/registrations", requireSession(deps), async (req, res) => {
    // SCRUM-83/AC10: a form with a missing field is refused before anything is written
    const result = validateRegistrationForm(req.body);
    if (!result.ok) return res.status(400).json({ errors: result.errors });

    const { id: attendeeId, token } = res.locals.user as SessionUser;
    const db = deps.forUser(token);

    // SCRUM-83/AC12: only an event listed for attendees can be registered for
    const event = await findPublicEvent(db, String(req.params.id));
    if (!event) return res.status(404).json(EVENT_NOT_FOUND);

    // SCRUM-83/AC3, AC4, AC5, AC17: the same rules as the card (SCRUM-71), checked again at submit time
    const refusal = registrationRefusal(event, new Date());
    if (refusal) return res.status(409).json({ error: refusal });

    // SCRUM-83/AC12: a new registration starts as Pending, stored as 'waitlisted' (the mapping agreed for SCRUM-71)
    const { error } = await db.from("event_registrations").insert({
      event_id: event.id,
      attendee_id: attendeeId,
      status: "waitlisted",
      registration_details: result.form,
    });
    // SCRUM-83/AC16: a repeated submit raced past the check above; the database's one-active-registration rule
    // refused it (23505 = unique violation), so the attendee is told they already have one
    if (error?.code === "23505") return res.status(409).json({ error: ALREADY_REGISTERED });
    // SCRUM-83/AC12: not saved, so not Pending: say so rather than report a registration that doesn't exist
    if (error) return res.status(500).json({ error: "We couldn't save your registration. Please try again." });
    res.status(201).json({ event_name: event.name, status: "pending" });
  });

  return router;
}
