import { Router } from "express";
import {
  CHANGE_REQUEST_MESSAGES,
  canRequestChange,
  canReviewEvents,
  changeRequestConflicts,
  conflictingRequestMessage,
  parseEventChangeRequestInput,
} from "@spm-t5/shared";
import type { SupabaseDeps } from "../supabase";
import { requireSession, type SessionUser } from "../middlewares/session";
import { lookUpRole } from "./events";

// SCRUM-67: venue_requirements too (an events column since SCRUM-111), so a request records the event's real value
const EVENT_FIELDS =
  "id, status, expected_attendance, preferred_start_datetime, preferred_end_datetime, venue_requirements, equipment_requirements_notes";

// SCRUM-66: an event organiser asks for changes to an event after it has been submitted.
export function changeRequestRoutes(deps: SupabaseDeps) {
  const router = Router();

  /** SCRUM-176: what a new request shares with the event's pending ones (the shared rule; empty when it may go ahead). */
  async function waitingConflicts(token: string, eventId: string, proposed: unknown): Promise<string[]> {
    const { data: pending } = await deps
      .forUser(token)
      .from("event_change_requests")
      .select("proposed_changes")
      .eq("event_id", eventId)
      .eq("status", "pending");
    return changeRequestConflicts(proposed, ((pending ?? []) as { proposed_changes: unknown }[]).map((r) => r.proposed_changes));
  }

  const conflicting = (waiting: string[]) => ({ code: "CONFLICTING_REQUEST", error: conflictingRequestMessage(waiting), waiting });

  // SCRUM-66/AC7: list an event's change requests (newest first) with whether each is pending, approved or rejected
  router.get("/:id/change-requests", requireSession(deps), async (req, res) => {
    const { token } = res.locals.user as SessionUser;
    const role = await lookUpRole(deps, res.locals.user as SessionUser);
    if (role === undefined || (role !== "event_organiser" && !canReviewEvents(role))) {
      return res.status(403).json({ error: "You are not allowed to view this event's change requests." });
    }
    // RLS: an organiser only gets rows for their own events, so someone else's event returns an empty list
    const { data } = await deps
      .forUser(token)
      .from("event_change_requests")
      .select("id, change_description, proposed_changes, status, requested_at, reviewed_at, review_notes")
      .eq("event_id", req.params.id)
      .order("requested_at", { ascending: false });
    return res.json(data ?? []);
  });

  // SCRUM-66/AC1-AC6, AC8-AC10: submit a change request. The event itself is never updated here (AC6).
  router.post("/:id/change-requests", requireSession(deps), async (req, res) => {
    const { id: userId, token } = res.locals.user as SessionUser;
    const role = await lookUpRole(deps, res.locals.user as SessionUser);
    if (role !== "event_organiser") {
      return res.status(403).json({ error: "Only the event's organiser can request changes to it." });
    }

    // Someone else's event looks exactly like one that doesn't exist (SCRUM-7/AC3)
    const { data: event } = await deps
      .forUser(token)
      .from("events")
      .select(EVENT_FIELDS)
      .eq("id", req.params.id)
      .eq("organiser_id", userId)
      .maybeSingle();
    if (!event) return res.status(404).json({ error: "Event not found." });

    // AC2, AC3: draft, cancelled, rejected and completed events can't be changed by request
    if (!canRequestChange(event.status as string)) {
      return res.status(409).json({ code: "NOT_ALLOWED", error: CHANGE_REQUEST_MESSAGES.NOT_ALLOWED });
    }

    // AC4, AC5, AC8-AC10: validate, and work out what actually differs from the event
    const parsed = parseEventChangeRequestInput(
      req.body,
      {
        expected_attendance: (event.expected_attendance as number | null) ?? null,
        preferred_start_datetime: (event.preferred_start_datetime as string | null) ?? null,
        preferred_end_datetime: (event.preferred_end_datetime as string | null) ?? null,
        venue_requirements: (event.venue_requirements as string | null) ?? null,
        equipment_requirements_notes: (event.equipment_requirements_notes as string | null) ?? null,
      },
      new Date(),
    );
    if (!parsed.ok) {
      return parsed.noChanges
        ? res.status(422).json({ code: "NO_CHANGES", error: CHANGE_REQUEST_MESSAGES.NO_CHANGES, fieldErrors: {} })
        : res.status(422).json({ code: "VALIDATION_FAILED", error: "Check the highlighted fields.", fieldErrors: parsed.fieldErrors });
    }

    // SCRUM-176/AC1, AC2: not while a pending request changes the same thing; the customer said in the Week 9 Q&A that the
    // coordinator processes it first. Migration 66 checks again, for two requests sent at the same moment.
    const waiting = await waitingConflicts(token, event.id as string, parsed.data.proposed_changes);
    if (waiting.length > 0) return res.status(409).json(conflicting(waiting));

    // AC6: only the request is saved; the row-level policy (migration 14) re-checks organiser and status
    const { data: created, error } = await deps
      .forUser(token)
      .from("event_change_requests")
      .insert({
        event_id: event.id,
        requested_by: userId,
        change_description: parsed.data.change_description,
        proposed_changes: parsed.data.proposed_changes,
        status: "pending",
      })
      .select("id, change_description, proposed_changes, status, requested_at")
      .single();
    if (error?.code === "CS176") {
      // SCRUM-176/AC1: another request for the same thing was saved between the check above and this insert
      return res.status(409).json(conflicting(await waitingConflicts(token, event.id as string, parsed.data.proposed_changes)));
    }
    if (error || !created) {
      // Only say the status blocks it when it really does now (it changed between the check above and the insert).
      // Any other refusal (a missing policy, a constraint, the database being down) is not the organiser's doing.
      const { data: current } = await deps
        .forUser(token)
        .from("events")
        .select("status")
        .eq("id", event.id)
        .maybeSingle();
      if (!current || !canRequestChange(current.status as string)) {
        return res.status(409).json({ code: "NOT_ALLOWED", error: CHANGE_REQUEST_MESSAGES.NOT_ALLOWED });
      }
      console.error("change request insert failed:", error?.code, error?.message);
      return res.status(500).json({ code: "SAVE_FAILED", error: CHANGE_REQUEST_MESSAGES.SAVE_FAILED });
    }
    return res.status(201).json({ ...created, message: CHANGE_REQUEST_MESSAGES.SUBMITTED });
  });

  return router;
}
