import { Router } from "express";
import { canCreateEventRequests, isRole } from "@spm-t5/shared";
import type { SupabaseDeps } from "../supabase";
import { requireSession, type SessionUser } from "../middlewares/session";

export function eventRequestRoutes(deps: SupabaseDeps) {
  const router = Router();

  // SCRUM-49: an event organiser creates and submits a new event request
  router.post("/", requireSession(deps), async (req, res) => {
    const { id: userId, token } = res.locals.user as SessionUser;

    // SCRUM-49 AC7: only event organisers may create event requests.
    // Checked here (not RLS) because RLS is still a blanket placeholder (02_rls.sql).
    const { data: profile } = await deps.forUser(token).from("users").select("role").eq("id", userId).maybeSingle();
    if (!isRole(profile?.role) || !canCreateEventRequests(profile.role)) {
      return res.status(403).json({ error: "You are not allowed to create event requests." });
    }

    // SCRUM-49 AC1: store every field. AC7: no organiser or organisation argument is sent; the database
    // function takes both from the caller's verified token (see supabase/migrations/08_create_event_request.sql).
    const b = req.body;
    const { data: event, error } = await deps
      .forUser(token)
      .rpc("create_event_request", {
        p_name: b.name,
        p_purpose: b.purpose,
        p_description: b.description,
        p_preferred_start_datetime: b.preferred_start_datetime,
        p_preferred_end_datetime: b.preferred_end_datetime,
        p_expected_attendance: b.expected_attendance,
        p_venue_requirements: b.venue_requirements,
        p_preferred_room_layout_id: b.preferred_room_layout_id,
        p_accessibility_requirements: b.accessibility_requirements,
        p_equipment_requirements_notes: b.equipment_requirements_notes,
        p_registration_required: b.registration_required,
        p_registration_capacity: b.registration_capacity,
        p_registration_opens_at: b.registration_opens_at,
        p_registration_closes_at: b.registration_closes_at,
      })
      .single();
    if (error || !event) return res.status(500).json({ error: "Could not create the event request." });

    res.status(201).json(event);
  });

  return router;
}
