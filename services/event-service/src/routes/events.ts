import { Router } from "express";
import { canReviewEvents, isEventStatus, isRole, type Role } from "@spm-t5/shared";
import type { SupabaseDeps } from "../supabase";
import { requireSession, type SessionUser } from "../middlewares/session";

/** Looks up the caller's role in the users table; undefined if missing or not a real role. */
async function lookUpRole(deps: SupabaseDeps, { id, token }: SessionUser): Promise<Role | undefined> {
  const { data: profile } = await deps.forUser(token).from("users").select("role").eq("id", id).maybeSingle();
  return isRole(profile?.role) ? profile.role : undefined;
}

export function eventRoutes(deps: SupabaseDeps) {
  const router = Router();

  // SCRUM-22/AC1: list submitted event requests for a coordinator
  // SCRUM-22/AC2: show own + unassigned events; hide events assigned to other coordinators
  router.get("/", requireSession(deps), async (req, res) => {
    const { id: userId, token } = res.locals.user as SessionUser;
    const role = await lookUpRole(deps, res.locals.user as SessionUser);
    if (role === undefined || !canReviewEvents(role)) {
      return res.status(403).json({ error: "You are not allowed to view submitted event requests." });
    }
    const { data: events } = await deps
      .forUser(token)
      .from("events")
      .select("id, name, status, submitted_at, organiser:organiser_id(full_name)")
      .eq("status", "submitted")
      .or(`assigned_coordinator_id.eq.${userId},assigned_coordinator_id.is.null`);
    const response = (events ?? []).map((e) => ({
      id: e.id,
      name: e.name,
      status: e.status,
      submitted_at: e.submitted_at,
      organiser_name: (e.organiser as { full_name: string } | null)?.full_name ?? null,
    }));
    return res.json(response);
  });

  // SCRUM-6: an event coordinator views the current status of any event
  router.get("/:id", requireSession(deps), async (req, res) => {
    const { id: userId, token } = res.locals.user as SessionUser;

    // SCRUM-6 AC3: only event coordinators and (SCRUM-7) event organisers may view event status
    const role = await lookUpRole(deps, res.locals.user as SessionUser);
    const isCoordinator = role !== undefined && canReviewEvents(role);
    const isOrganiser = role === "event_organiser";
    if (!isCoordinator && !isOrganiser) {
      return res.status(403).json({ error: "You are not allowed to view this event's status." });
    }

    let query = deps
      .forUser(token)
      .from("events")
      .select("id, name, status")
      .eq("id", req.params.id);
      // the following line is commented out because we don't restrict only assigned coord to see event status
      // .eq("assigned_coordinator_id", userId)

    // SCRUM-7 AC3: an organiser only sees events they submitted
    if (isOrganiser) query = query.eq("organiser_id", userId);

    const { data: event } = await query.maybeSingle();

    // SCRUM-7 AC3: someone else's event looks exactly like one that doesn't exist
    if (!event) return res.status(404).json({ error: "Event not found." });

    res.json(event);
  });

  // SCRUM-8: an event coordinator changes an event's status
  router.patch("/:id/status", requireSession(deps), async (req, res) => {
    const { token } = res.locals.user as SessionUser;

    // SCRUM-8 AC4: only event coordinators may change an event's status
    const role = await lookUpRole(deps, res.locals.user as SessionUser);
    if (role === undefined || !canReviewEvents(role)) {
      return res.status(403).json({ error: "You are not allowed to change this event's status." });
    }

    // SCRUM-8 AC3: only the real statuses are accepted; nothing is saved otherwise
    const { status } = req.body;
    if (!isEventStatus(status)) {
      return res.status(400).json({ error: "Invalid status." });
    }

    // SCRUM-8 AC1 + AC5: change the status and record it in event_status_history together, all-or-nothing
    // (see supabase/migrations/04_change_event_status.sql). The reason is optional.
    const { data: event } = await deps
      .forUser(token)
      .rpc("change_event_status", {
        p_event_id: req.params.id,
        p_new_status: status,
        p_reason: typeof req.body.reason === "string" ? req.body.reason : null,
      })
      .maybeSingle();
    if (!event) return res.status(404).json({ error: "Event not found." });

    // SCRUM-8 AC2: confirm the change by sending back the updated event
    res.json(event);
  });

  return router;
}
