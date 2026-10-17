import { Router, type Response } from "express";
import {
  CHANGE_REQUEST_REVIEW_MESSAGES,
  isClosedEventStatus,
  parseChangeRequestRejection,
  readChangeRequest,
  type AffectedArrangement,
} from "@spm-t5/shared";
import { requireSession, type SessionUser } from "../middlewares/session";
import { readAffectedArrangements, sendBackOf } from "../services/arrangementImpact";
import type { SupabaseDeps } from "../supabase";
import { EDITABLE_COLUMNS, type EditableEventRow } from "./eventDetails";
import { lookUpRole } from "./events";

type ChangeRequestRow = {
  id: string;
  event_id: string;
  change_description: string;
  proposed_changes: unknown;
  status: string;
  requested_at: string;
  reviewed_at: string | null;
  review_notes: string | null;
};

const NOT_ALLOWED = { error: "Only the event's assigned coordinator can review its change requests." };
const NOT_FOUND = { error: "Change request not found." };
const OUTDATED = { code: "OUTDATED", error: CHANGE_REQUEST_REVIEW_MESSAGES.outdated };
const UNSUPPORTED = { code: "UNSUPPORTED", error: CHANGE_REQUEST_REVIEW_MESSAGES.unsupported };
const ALREADY_REVIEWED = { code: "ALREADY_REVIEWED", error: CHANGE_REQUEST_REVIEW_MESSAGES.alreadyReviewed };
const LOCKED = { code: "EVENT_LOCKED", error: "A completed, cancelled or rejected event can't be changed." };

/** review_change_request()'s refusals (migration 42) as answers; nothing from the database reaches the caller. */
function reviewFailed(res: Response, error: { code?: string; message: string }) {
  if (error.code === "42501") return res.status(403).json(NOT_ALLOWED);
  if (error.code === "CS067") return res.status(409).json(ALREADY_REVIEWED);
  if (error.code === "CS111") return res.status(409).json(OUTDATED);
  if (error.code === "CS112") return res.status(409).json(LOCKED);
  if (error.code === "22023") return res.status(409).json(UNSUPPORTED);
  console.error("review_change_request failed:", error.message);
  return res.status(500).json({ error: "We couldn't save the decision. Please try again." });
}

/**
 * SCRUM-67 (docs/specs/review-change-request.md): the event's assigned coordinator reviews an organiser's change request.
 * The route checks who and what and reads the request against the event; review_change_request() (migration 42) checks
 * again and decides it, an approval through update_event_details() so it is the same save as an edit (SCRUM-111 to 113).
 */
export function changeRequestReviewRoutes(deps: SupabaseDeps) {
  const router = Router();

  /** The request and its event, if the caller is the event's current assigned coordinator (AC7). */
  async function load(user: SessionUser, id: string, res: Response) {
    if ((await lookUpRole(deps, user)) !== "event_coordinator") {
      res.status(403).json(NOT_ALLOWED);
      return null;
    }
    const db = deps.forUser(user.token);
    const { data: request } = await db.from("event_change_requests").select("*").eq("id", id).maybeSingle<ChangeRequestRow>();
    if (!request) {
      res.status(404).json(NOT_FOUND);
      return null;
    }
    const { data: event } = await db
      .from("events")
      .select(`${EDITABLE_COLUMNS}, name`)
      .eq("id", request.event_id)
      .maybeSingle<EditableEventRow & { name: string }>();
    if (!event || event.assigned_coordinator_id !== user.id) {
      res.status(403).json(NOT_ALLOWED);
      return null;
    }
    return { request, event, read: readChangeRequest(request.proposed_changes, event) };
  }

  /** Whether approving is possible now: pending, open event, nothing outdated or unsupported, something to apply. */
  function approvable(loaded: NonNullable<Awaited<ReturnType<typeof load>>>) {
    const { request, event, read } = loaded;
    if (request.status !== "pending") return ALREADY_REVIEWED;
    if (isClosedEventStatus(event.status)) return LOCKED;
    if (read.outdated) return OUTDATED;
    if (read.unsupported.length > 0 || read.rows.length === 0) return UNSUPPORTED;
    return null;
  }

  // AC2, AC8: each requested change with the current value, what can be done, and (SCRUM-112) what approving affects
  router.get("/:id", requireSession(deps), async (req, res) => {
    const user = res.locals.user as SessionUser;
    const loaded = await load(user, String(req.params.id), res);
    if (!loaded) return;
    const { request, event, read } = loaded;
    const canApprove = approvable(loaded) === null;
    let affected: AffectedArrangement[] = [];
    if (canApprove) {
      affected = (await readAffectedArrangements(deps, user.token, event, read.changes)) ?? [];
    }
    return res.set("Cache-Control", "no-store").json({
      id: request.id,
      eventId: event.id,
      eventName: event.name,
      status: request.status,
      changeDescription: request.change_description,
      requestedAt: request.requested_at,
      reviewedAt: request.reviewed_at,
      reviewNotes: request.review_notes,
      rows: read.rows,
      outdated: read.outdated,
      unsupported: read.unsupported,
      canApprove,
      canReject: request.status === "pending",
      affected,
    });
  });

  // AC3: apply the request; its affected arrangements go back for review in the same step (SCRUM-113)
  router.post("/:id/approve", requireSession(deps), async (req, res) => {
    const user = res.locals.user as SessionUser;
    const loaded = await load(user, String(req.params.id), res);
    if (!loaded) return;
    const refusal = approvable(loaded);
    if (refusal) return res.status(409).json(refusal);

    const affected = await readAffectedArrangements(deps, user.token, loaded.event, loaded.read.changes);
    if (!affected) return res.status(500).json({ error: "We couldn't check the event's arrangements. Please try again." });
    const { error } = await deps.forUser(user.token).rpc("review_change_request", {
      p_request_id: loaded.request.id,
      p_approve: true,
      p_changes: loaded.read.changes,
      ...(affected.length > 0 ? { p_send_back: sendBackOf(affected) } : {}),
    });
    if (error) return reviewFailed(res, error);
    return res.json({ status: "approved", message: "Change request approved. The event has been updated." });
  });

  // AC4, AC5: reject with a reason; the event is not touched
  router.post("/:id/reject", requireSession(deps), async (req, res) => {
    const user = res.locals.user as SessionUser;
    const loaded = await load(user, String(req.params.id), res);
    if (!loaded) return;
    if (loaded.request.status !== "pending") return res.status(409).json(ALREADY_REVIEWED);
    const parsed = parseChangeRequestRejection(req.body);
    if (!parsed.ok) {
      return res.status(422).json({ code: "VALIDATION_FAILED", error: parsed.error, fieldErrors: { reason: parsed.error } });
    }
    const { error } = await deps.forUser(user.token).rpc("review_change_request", {
      p_request_id: loaded.request.id,
      p_approve: false,
      p_reason: parsed.reason,
    });
    if (error) return reviewFailed(res, error);
    return res.json({ status: "rejected", message: "Change request rejected. The event is unchanged." });
  });

  return router;
}
