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
  // SCRUM-22/AC3: optional ?search= filters by event name or organiser name (case-insensitive)
  // SCRUM-22/AC4: optional ?status= filters by one or more statuses; defaults to submitted
  // SCRUM-22/AC5: optional ?from= and ?to= filter by submission date range (YYYY-MM-DD)
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
      .or(`assigned_coordinator_id.eq.${userId},assigned_coordinator_id.is.null`);
    const statusParam = req.query.status;
    const statuses: string[] = statusParam
      ? (Array.isArray(statusParam) ? statusParam : [statusParam]).filter((s): s is string => typeof s === "string")
      : ["submitted"];
    const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
    const from = typeof req.query.from === "string" ? req.query.from : null;
    const to = typeof req.query.to === "string" ? req.query.to : null;
    const fromDate = from ? new Date(from + "T00:00:00.000Z") : null;
    const toDate = to ? new Date(to + "T23:59:59.999Z") : null;
    const response = (events ?? [])
      .filter((e) => {
        if (!statuses.includes(e.status as string)) return false;
        if (fromDate && e.submitted_at && new Date(e.submitted_at as string) < fromDate) return false;
        if (toDate && e.submitted_at && new Date(e.submitted_at as string) > toDate) return false;
        if (!search) return true;
        const nameMatch = typeof e.name === "string" && e.name.toLowerCase().includes(search);
        const organiserMatch =
          typeof (e.organiser as { full_name: string } | null)?.full_name === "string" &&
          (e.organiser as { full_name: string }).full_name.toLowerCase().includes(search);
        return nameMatch || organiserMatch;
      })
      .map((e) => ({
        id: e.id,
        name: e.name,
        status: e.status,
        submitted_at: e.submitted_at,
        organiser_name: (e.organiser as { full_name: string } | null)?.full_name ?? null,
      }));
    return res.json(response);
  });

  // SCRUM-6: an event coordinator views the current status of any event
  // SCRUM-23/AC1+AC2: returns the full details of a submitted event request
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
      .select(
        "id, name, status, purpose, preferred_start_datetime, preferred_end_datetime, " +
        "expected_attendance, preferred_room_layout:preferred_room_layout_id(name), " +
        "accessibility_requirements, equipment_requirements_notes, submitted_at, " +
        "organiser:organiser_id(full_name)"
      )
      .eq("id", req.params.id);

    // SCRUM-7 AC3: an organiser only sees events they submitted
    if (isOrganiser) query = query.eq("organiser_id", userId);

    const { data: event } = await query.maybeSingle();

    // SCRUM-7 AC3: someone else's event looks exactly like one that doesn't exist
    if (!event) return res.status(404).json({ error: "Event not found." });

    res.json({
      id: event.id,
      name: event.name,
      status: event.status,
      purpose: (event.purpose as string | null) ?? null,
      preferred_start_datetime: (event.preferred_start_datetime as string | null) ?? null,
      preferred_end_datetime: (event.preferred_end_datetime as string | null) ?? null,
      expected_attendance: (event.expected_attendance as number | null) ?? null,
      preferred_layout_name: (event.preferred_room_layout as { name: string } | null)?.name ?? null,
      accessibility_requirements: (event.accessibility_requirements as string | null) ?? null,
      equipment_requirements_notes: (event.equipment_requirements_notes as string | null) ?? null,
      submitted_at: (event.submitted_at as string | null) ?? null,
      organiser_name: (event.organiser as { full_name: string } | null)?.full_name ?? null,
    });
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
