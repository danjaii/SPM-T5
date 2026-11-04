import { Router } from "express";
import { parseRegistrationSettings } from "@spm-t5/shared";
import { requireSession, type SessionUser } from "../middlewares/session";
import type { SupabaseDeps } from "../supabase";

const COLUMNS =
  "id, status, assigned_coordinator_id, registration_required, registration_capacity, registration_opens_at, registration_closes_at, preferred_start_datetime";

const NOT_ASSIGNED = { error: "Only the coordinator assigned to this event can change its registration." };
const NOT_FOUND = { error: "Event not found." };

type EventRow = {
  id: string;
  status: string;
  assigned_coordinator_id: string | null;
  registration_required: boolean;
  registration_capacity: number | null;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
  preferred_start_datetime: string | null;
};

/**
 * SCRUM-185/AC4 (docs/specs/registration-settings-while-replanning.md): the assigned coordinator reads and adjusts an event's
 * registration capacity and window, for instance while a venue block has returned the event to Planning. The database decides
 * (update_registration_settings(), migration 84); the route checks who is calling, runs the shared validation (the same as the
 * form's) and turns the database's refusals into responses.
 */
export function registrationSettingsRoutes(deps: SupabaseDeps) {
  const router = Router();

  router.get("/:id/registration-settings", requireSession(deps), async (req, res) => {
    const { id: userId, token } = res.locals.user as SessionUser;
    const db = deps.forUser(token);
    const { data } = await db.from("events").select(COLUMNS).eq("id", req.params.id).maybeSingle();
    const event = data as EventRow | null;
    if (!event) return res.status(404).json(NOT_FOUND);
    if (event.assigned_coordinator_id !== userId) return res.status(403).json(NOT_ASSIGNED);

    // Only a Confirmed registration holds a place (SCRUM-83/AC13), so only those limit how far the capacity can be lowered
    const { count, error } = await db.from("event_registrations").select("id", { count: "exact", head: true }).eq("event_id", event.id).eq("status", "registered");
    // A failed count must not read as "nobody is confirmed", which would invite a capacity the database then refuses
    if (error || count === null) return res.status(500).json({ error: "We couldn't load this event's registration settings. Please try again." });

    return res.json({
      status: event.status,
      registrationRequired: event.registration_required,
      capacity: event.registration_capacity,
      opensAt: event.registration_opens_at,
      closesAt: event.registration_closes_at,
      eventStart: event.preferred_start_datetime,
      confirmedCount: count,
      // registration_open for attendees needs a Confirmed event (register_for_event, migration 68), whatever the window says
      closedByStatus: event.status !== "confirmed",
    });
  });

  router.put("/:id/registration-settings", requireSession(deps), async (req, res) => {
    const { id: userId, token } = res.locals.user as SessionUser;
    const db = deps.forUser(token);
    const { data } = await db.from("events").select(COLUMNS).eq("id", req.params.id).maybeSingle();
    const event = data as EventRow | null;
    if (!event) return res.status(404).json(NOT_FOUND);
    // The role comes before the body (185-S4e), so a refused caller learns nothing about what would have been accepted
    if (event.assigned_coordinator_id !== userId) return res.status(403).json(NOT_ASSIGNED);

    const parsed = parseRegistrationSettings(req.body, event.preferred_start_datetime);
    if (!parsed.ok) return res.status(422).json({ code: "VALIDATION_FAILED", error: "Check the highlighted fields.", fieldErrors: parsed.fieldErrors });

    const { registration_capacity, registration_opens_at, registration_closes_at } = parsed.data;
    const { error } = await db.rpc("update_registration_settings", {
      p_event_id: event.id,
      p_capacity: registration_capacity,
      p_opens: registration_opens_at,
      p_closes: registration_closes_at,
    });
    if (error) {
      if (error.code === "42501") return res.status(403).json(NOT_ASSIGNED);
      if (error.code === "P0002") return res.status(404).json(NOT_FOUND);
      if (error.code === "CL001") return res.status(409).json({ code: "EVENT_LOCKED", error: "This event is closed, so its registration can't be changed." });
      if (error.code === "22023") {
        // the database names the field in its hint; an event that takes no registrations has no field to blame
        const field = !error.hint || error.hint === "registration" ? "form" : error.hint;
        return res.status(422).json({ code: "VALIDATION_FAILED", error: error.message, fieldErrors: { [field]: error.message } });
      }
      return res.status(500).json({ error: "We couldn't save the registration settings. Please try again." });
    }

    return res.json({ capacity: registration_capacity, opensAt: registration_opens_at, closesAt: registration_closes_at, message: "Registration settings saved." });
  });

  return router;
}
