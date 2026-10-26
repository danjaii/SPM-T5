import { Router } from "express";
import { parseEventRequestDraft } from "@spm-t5/shared";
import type { SupabaseDeps } from "../supabase";
import { requireSession, type SessionUser } from "../middlewares/session";

/** SCRUM-53: an event organiser saves an incomplete event request as a draft. */
export function eventDraftRoutes(deps: SupabaseDeps) {
  const router = Router();

  // SCRUM-53/AC1: store the request with status draft. No organiser or organisation argument is sent: the database function
  // takes both from the caller's verified token (supabase/migrations/52_event_drafts.sql).
  router.post("/drafts", requireSession(deps), async (req, res) => {
    const { token } = res.locals.user as SessionUser;

    const parsed = parseEventRequestDraft(req.body);
    if (!parsed.ok) {
      return res.status(422).json({ code: "VALIDATION_FAILED", error: "Check the highlighted fields.", fieldErrors: parsed.fieldErrors });
    }

    const b = parsed.data;
    const { data: draft, error } = await deps
      .forUser(token)
      .rpc("create_event_draft", {
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
    if (error || !draft) return res.status(500).json({ error: "Could not save the draft." });

    res.status(201).json(draft);
  });

  return router;
}
