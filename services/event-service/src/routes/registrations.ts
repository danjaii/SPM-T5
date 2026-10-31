import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { registrationStatus, validateRegistrationForm, validateVipEmail } from "@spm-t5/shared";
import type { SupabaseDeps } from "../supabase";
import { requireSession, type SessionUser } from "../middlewares/session";
import { lookUpRole } from "./events";
import { toUpcomingEvent, type PublicEventRow } from "../services/upcomingEvents";
import {
  ALREADY_REGISTERED,
  DECISION_REFUSALS,
  REGISTRATION_CLOSED,
  registrationRefusal,
  toEventRegistration,
  toMyRegistration,
  withdrawalRefusal,
  VIP_ALREADY_REGISTERED,
  vipRefusal,
  type EventRegistrationRow,
  type MyRegistrationRow,
} from "../services/registrations";

const EVENT_NOT_FOUND = { error: "Event not found." };

/** One events row as GET /events/managed selects it (SCRUM-74). */
interface ManagedEventRow {
  id: string;
  name: string;
  status: string;
  preferred_start_datetime: string | null;
  registration_capacity: number | null;
}

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

  // SCRUM-74: the events whose registrations the caller can view, for the dropdown on the registrations page
  router.get("/managed", requireSession(deps), async (_req, res) => {
    const user = res.locals.user as SessionUser;
    const role = await lookUpRole(deps, user);
    // SCRUM-74/AC1: registration information is for organisers and coordinators only
    if (role !== "event_organiser" && role !== "event_coordinator") {
      return res.status(403).json({ error: "Only event organisers and coordinators can view registrations." });
    }
    // SCRUM-74/AC1: a coordinator's own assigned events only (RLS lets coordinators read other events too)
    // SCRUM-74/AC2: an organiser's own events, in the same shape
    const column = role === "event_organiser" ? "organiser_id" : "assigned_coordinator_id";
    const { data } = await deps
      .forUser(user.token)
      .from("events")
      .select("id, name, status, preferred_start_datetime, registration_capacity")
      .eq(column, user.id);
    res.json(
      ((data ?? []) as ManagedEventRow[]).map((e) => ({
        id: e.id,
        name: e.name,
        status: e.status,
        start_at: e.preferred_start_datetime,
        registration_capacity: e.registration_capacity,
        // SCRUM-169/AC3: only the organiser decides on a Pending registration; a coordinator's view stays read-only
        can_decide: role === "event_organiser",
      })),
    );
  });

  // SCRUM-83/AC7: what the registration form shows about the event: name, date and time, and location
  router.get("/:id/registration-form", requireSession(deps), async (req, res) => {
    const { id: attendeeId, token } = res.locals.user as SessionUser;
    const db = deps.forUser(token);
    const event = await findPublicEvent(db, String(req.params.id));
    if (!event) return res.status(404).json(EVENT_NOT_FOUND);

    // SCRUM-83/AC8: the form starts with the attendee's own name, email and contact number, under the keys it submits
    const { data: profile } = await db.from("users").select("full_name").eq("id", attendeeId).maybeSingle();
    // SCRUM-154/AC5: the attendee's own email and phone are not readable from users (migration 52); a function returns them
    const { data: contact } = await db.rpc("my_contact_details");
    const mine = (contact as { email: string; phone: string | null }[] | null)?.[0];
    // SCRUM-83/AC9: no contact number in the profile means an empty field, not "null"
    const prefill = { name: profile?.full_name, email: mine?.email, phone: mine?.phone ?? "" };

    res.json({ event: toUpcomingEvent(event, new Date()), prefill });
  });

  // SCRUM-83/AC15: the event's registrations, for the page organisers and coordinators see.
  // Who may read them is RLS's job (supabase/migrations/11_event_registrations.sql), not this route's.
  router.get("/:id/registrations", requireSession(deps), async (req, res) => {
    const { token } = res.locals.user as SessionUser;
    const db = deps.forUser(token);
    const { data, error } = await db
      .from("event_registrations")
      .select("id, status, registered_at, is_vip, registration_details")
      .eq("event_id", req.params.id);
    // SCRUM-74/AC5: the attendee's profile too, for a registration with no form details. SCRUM-154/AC3, AC4: users' email and
    // phone are not readable (migration 52), so a function returns them, and only to the event's organiser or coordinator
    const { data: contacts, error: contactsError } = await db.rpc("event_registration_contacts", { p_event_id: req.params.id });
    // An empty list must mean nobody has registered, so a failed call is an error, not []
    const failed = "We couldn't load this event's registrations. Please try again.";
    if (error || contactsError) return res.status(500).json({ error: failed });
    const contactOf = new Map(
      ((contacts ?? []) as { registration_id: string; full_name: string | null; email: string | null; phone: string | null }[]).map(
        (c) => [c.registration_id, { full_name: c.full_name, email: c.email, phone: c.phone }] as const,
      ),
    );

    res.json(
      ((data ?? []) as EventRegistrationRow[])
        .map((row) => ({ ...row, attendee: contactOf.get(row.id) ?? null }))
        // SCRUM-74/AC8: newest first (ISO timestamps sort in time order as text)
        .sort((a, b) => b.registered_at.localeCompare(a.registered_at))
        .map(toEventRegistration),
    );
  });

  router.post("/:id/registrations", requireSession(deps), async (req, res) => {
    // SCRUM-83/AC10: a form with a missing field is refused before anything is written
    const result = validateRegistrationForm(req.body);
    if (!result.ok) return res.status(400).json({ errors: result.errors });

    const { token } = res.locals.user as SessionUser;
    const db = deps.forUser(token);

    // SCRUM-83/AC12: only an event listed for attendees can be registered for
    const event = await findPublicEvent(db, String(req.params.id));
    if (!event) return res.status(404).json(EVENT_NOT_FOUND);

    // SCRUM-83/AC3, AC4, AC5, AC17: the same rules as the card (SCRUM-71), checked again at submit time
    const refusal = registrationRefusal(event, new Date());
    if (refusal) return res.status(409).json({ error: refusal });

    // SCRUM-169/AC1, AC2, AC5: the database decides Confirmed or Pending, so two attendees can't both take the last place
    const { data: saved, error } = await db.rpc("register_for_event", { p_event_id: event.id, p_details: result.form });
    // SCRUM-83/AC16: a repeated submit raced past the check above; the database's one-active-registration rule
    // refused it (23505 = unique violation), so the attendee is told they already have one
    if (error?.code === "23505") return res.status(409).json({ error: ALREADY_REGISTERED });
    // SCRUM-169/AC1: registration closed after the check above
    if (error?.code === "CS169") return res.status(409).json({ error: REGISTRATION_CLOSED });
    // SCRUM-83/AC12: not saved: say so rather than report a registration that doesn't exist
    if (error) return res.status(500).json({ error: "We couldn't save your registration. Please try again." });
    res.status(201).json({ event_name: event.name, status: registrationStatus(saved) });
  });

  // SCRUM-169/AC3, AC4: the event's organiser confirms or declines a Pending registration.
  // Who may decide is decide_registration()'s job (migration 68), not this route's.
  router.post("/:id/registrations/:registrationId/decision", requireSession(deps), async (req, res) => {
    const { decision } = req.body ?? {};
    if (decision !== "confirm" && decision !== "decline") {
      return res.status(400).json({ error: "The decision must be confirm or decline." });
    }

    const { token } = res.locals.user as SessionUser;
    const { data, error } = await deps
      .forUser(token)
      .rpc("decide_registration", { p_registration_id: req.params.registrationId, p_decision: decision });
    if (error?.code === "CS169" && error.message === "NOT_FOUND") return res.status(404).json({ error: "Registration not found." });
    if (error?.code === "CS169" && DECISION_REFUSALS[error.message]) return res.status(409).json({ error: DECISION_REFUSALS[error.message] });
    if (error) return res.status(500).json({ error: "We couldn't save your decision. Please try again." });
    res.json({ status: registrationStatus(data) });
  });

  // SCRUM-170: the event's organiser adds a VIP past the registration cap, up to the venue's capacity.
  // Who may add one, and the limits, are add_vip_registration()'s job (migration 69), not this route's.
  router.post("/:id/vip-registrations", requireSession(deps), async (req, res) => {
    const result = validateVipEmail(req.body?.email);
    if (!result.ok) return res.status(400).json({ errors: { email: result.error } });

    const { token } = res.locals.user as SessionUser;
    const { error } = await deps.forUser(token).rpc("add_vip_registration", { p_event_id: req.params.id, p_email: result.email });
    if (error?.code === "23505") return res.status(409).json({ error: VIP_ALREADY_REGISTERED });
    if (error?.code === "CS170") {
      if (error.message === "NOT_FOUND") return res.status(404).json(EVENT_NOT_FOUND);
      if (error.message === "ACCOUNT_NOT_FOUND") return res.status(404).json({ error: "No attendee account uses that email." });
      const refusal = vipRefusal(error.message, error.details);
      if (refusal) return res.status(409).json({ error: refusal });
    }
    if (error) return res.status(500).json({ error: "We couldn't add this VIP. Please try again." });
    res.status(201).json({ status: "confirmed" });
  });

  return router;
}
