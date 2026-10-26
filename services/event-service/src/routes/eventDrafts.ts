import { Router } from "express";
import { canCreateEventRequests, parseEventRequestDraft, type EventDraftInput } from "@spm-t5/shared";
import type { SupabaseDeps } from "../supabase";
import { requireSession, type SessionUser } from "../middlewares/session";
import { lookUpRole } from "./events";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The columns a draft is made of, as the form needs them to pre-fill (SCRUM-54/AC1). */
const DRAFT_COLUMNS = [
  "id", "name", "purpose", "description", "preferred_start_datetime", "preferred_end_datetime", "expected_attendance",
  "venue_requirements", "preferred_room_layout_id", "accessibility_requirements", "equipment_requirements_notes",
  "registration_required", "registration_capacity", "registration_opens_at", "registration_closes_at",
  "status", "is_draft", "submitted_at", "created_at", "updated_at",
].join(", ");

/** The draft fields as the database functions take them (SCRUM-53 create_event_draft, SCRUM-54 update_event_draft). */
function draftArguments(b: EventDraftInput) {
  return {
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
  };
}

/** SCRUM-53: an event organiser saves an incomplete event request as a draft. SCRUM-54: and reopens it. */
export function eventDraftRoutes(deps: SupabaseDeps) {
  const router = Router();

  // SCRUM-53/AC1: store the request with status draft. No organiser or organisation argument is sent: the database function
  // takes both from the caller's verified token (supabase/migrations/52_event_drafts.sql).
  router.post("/drafts", requireSession(deps), async (req, res) => {
    const user = res.locals.user as SessionUser;
    const { token } = user;

    // SCRUM-53/AC4: only event organisers save drafts. RLS enforces this too (migration 52: organiser-only INSERT on events);
    // this check is defence-in-depth and gives a clean 403 instead of a raw 42501 from the database.
    const role = await lookUpRole(deps, user);
    if (role === undefined || !canCreateEventRequests(role)) {
      return res.status(403).json({ error: "You are not allowed to create event requests." });
    }

    const parsed = parseEventRequestDraft(req.body);
    if (!parsed.ok) {
      return res.status(422).json({ code: "VALIDATION_FAILED", error: "Check the highlighted fields.", fieldErrors: parsed.fieldErrors });
    }

    const { data: draft, error } = await deps
      .forUser(token)
      .rpc("create_event_draft", draftArguments(parsed.data))
      .single();
    if (error || !draft) return res.status(500).json({ error: "Could not save the draft." });

    res.status(201).json(draft);
  });

  // SCRUM-54/AC1: open a saved draft. Read as the caller, so RLS (migration 14) only shows them their own events.
  router.get("/drafts/:id", requireSession(deps), async (req, res) => {
    const user = res.locals.user as SessionUser;
    const role = await lookUpRole(deps, user);
    if (role === undefined || !canCreateEventRequests(role)) {
      return res.status(403).json({ error: "You are not allowed to create event requests." });
    }

    const id = String(req.params.id);
    const { data: draft } = UUID.test(id)
      ? await deps.forUser(user.token).from("events").select(DRAFT_COLUMNS).eq("id", id).maybeSingle()
      : { data: null };
    if (!draft) return res.status(404).json({ error: "Draft not found." });

    res.json(draft);
  });

  // SCRUM-54/AC2: save the draft again. The whole form is sent, so a field left out or empty is cleared. Status, organiser,
  // organisation and coordinator are not arguments of update_event_draft, so the body cannot reach them.
  router.put("/drafts/:id", requireSession(deps), async (req, res) => {
    const user = res.locals.user as SessionUser;
    const role = await lookUpRole(deps, user);
    if (role === undefined || !canCreateEventRequests(role)) {
      return res.status(403).json({ error: "You are not allowed to create event requests." });
    }

    const id = String(req.params.id);
    const { data: draft } = UUID.test(id)
      ? await deps.forUser(user.token).from("events").select("id").eq("id", id).maybeSingle()
      : { data: null };
    if (!draft) return res.status(404).json({ error: "Draft not found." });

    const parsed = parseEventRequestDraft(req.body);
    if (!parsed.ok) {
      return res.status(422).json({ code: "VALIDATION_FAILED", error: "Check the highlighted fields.", fieldErrors: parsed.fieldErrors });
    }

    const { data: saved, error } = await deps
      .forUser(user.token)
      .rpc("update_event_draft", { p_event_id: id, ...draftArguments(parsed.data) })
      .maybeSingle();
    if (error) return res.status(500).json({ error: "Could not save the draft." });
    if (!saved) return res.status(404).json({ error: "Draft not found." });

    res.json(saved);
  });

  return router;
}
