import { Router } from "express";
import { isClosedEventStatus } from "@spm-t5/shared";
import type { SupabaseDeps } from "../supabase";
import { requireLead } from "../middlewares/lead";
import { requireSession, type SessionUser } from "../middlewares/session";

/** Postgres insufficient_privilege: what the Lead functions raise for a caller or coordinator they won't serve. */
const PG_DENIED = "42501";

/** How the Lead's assignment functions refuse (SQLSTATEs from migration 23), and what the Lead is told. */
const ASSIGNMENT_REFUSALS: Record<string, { status: number; error: string }> = {
  [PG_DENIED]: { status: 403, error: "Only an Event Coordinator Lead can do this." }, // SCRUM-78/AC9
  CL001: { status: 409, error: "This event is closed, so its coordinator can't be changed." }, // BR2
  CL002: { status: 409, error: "This event has already been assigned to a coordinator." }, // SCRUM-78/AC5
  CL003: { status: 422, error: "Choose one of your active coordinators." }, // BR4, SCRUM-78/AC7
  P0002: { status: 404, error: "Event not found." },
};

interface AssignmentEventRow {
  id: string;
  name: string;
  status: string;
  assigned_coordinator_id: string | null;
  preferred_start_datetime: string | null;
  preferred_end_datetime: string | null;
  expected_attendance: number | null;
  submitted_at: string | null;
  organiser: { full_name: string | null } | null;
}

/**
 * Event Coordinator Lead pages and actions (docs/specs/event-coordinator-lead-role.md). Every route is behind
 * requireSession + requireLead (SCRUM-75/AC7), and reads or writes as the caller so RLS applies too.
 */
export function leadRoutes(deps: SupabaseDeps) {
  const router = Router();
  router.use(requireSession(deps), requireLead(deps));

  // SCRUM-77/AC1-AC5: the shared queue; which requests are in it, and their order, is decided by lead_unassigned_queue()
  router.get("/queue", async (_req, res) => {
    const { token } = res.locals.user as SessionUser;
    const { data, error } = await deps.forUser(token).rpc("lead_unassigned_queue");
    if (error) {
      console.error("lead_unassigned_queue failed:", error.message);
      return res.status(500).json({ error: "We couldn't load the unassigned event requests. Please try again." });
    }
    return res.json(data ?? []);
  });

  // SCRUM-81/AC1, AC3-AC6: the Lead's active coordinators with their workload counts (lead_coordinator_overview())
  router.get("/coordinators", async (_req, res) => {
    const { token } = res.locals.user as SessionUser;
    const { data, error } = await deps.forUser(token).rpc("lead_coordinator_overview");
    if (error) {
      console.error("lead_coordinator_overview failed:", error.message);
      return res.status(500).json({ error: "We couldn't load your coordinators. Please try again." });
    }
    return res.json(data ?? []);
  });

  // SCRUM-81/AC2, AC4: one coordinator's non-closed events; the database refuses a coordinator the Lead doesn't supervise
  router.get("/coordinators/:id/events", async (req, res) => {
    const { token } = res.locals.user as SessionUser;
    const { data, error } = await deps.forUser(token).rpc("lead_coordinator_events", { p_coordinator_id: req.params.id });
    if (error?.code === PG_DENIED) return res.status(403).json({ error: "You can only view coordinators you supervise." });
    if (error) {
      console.error("lead_coordinator_events failed:", error.message);
      return res.status(500).json({ error: "We couldn't load this coordinator's events. Please try again." });
    }
    return res.json(data ?? []);
  });

  // SCRUM-78/AC1, AC6, AC7: what the assign step shows: the event, whether it can be assigned, and the Lead's eligible
  // coordinators with their workload counts (the same list as the overview: active and linked to this Lead)
  router.get("/events/:id/assignment", async (req, res) => {
    const { token } = res.locals.user as SessionUser;
    const { data: event } = await deps
      .forUser(token)
      .from("events")
      .select(
        "id, name, status, assigned_coordinator_id, preferred_start_datetime, preferred_end_datetime, " +
        "expected_attendance, submitted_at, organiser:organiser_id(full_name)",
      )
      .eq("id", req.params.id)
      .maybeSingle<AssignmentEventRow>();
    if (!event) return res.status(404).json({ error: "Event not found." });

    const canAssign = event.assigned_coordinator_id === null && !isClosedEventStatus(event.status);
    let coordinators: unknown[] = [];
    if (canAssign) {
      const { data, error } = await deps.forUser(token).rpc("lead_coordinator_overview");
      if (error) {
        console.error("lead_coordinator_overview failed:", error.message);
        return res.status(500).json({ error: "We couldn't load your coordinators. Please try again." });
      }
      coordinators = data ?? [];
    }

    return res.json({
      event: {
        id: event.id,
        name: event.name,
        status: event.status,
        organiser_name: event.organiser?.full_name ?? null,
        preferred_start_datetime: event.preferred_start_datetime,
        preferred_end_datetime: event.preferred_end_datetime,
        expected_attendance: event.expected_attendance,
        submitted_at: event.submitted_at,
      },
      canAssign,
      coordinators,
    });
  });

  // SCRUM-78/AC2-AC9: assign; lead_assign_coordinator() (migration 23) checks everything, atomically
  router.post("/events/:id/assign", async (req, res) => {
    const { token } = res.locals.user as SessionUser;
    const coordinatorId = typeof req.body?.coordinator_id === "string" ? req.body.coordinator_id.trim() : "";
    if (!coordinatorId) return res.status(400).json({ error: "Choose a coordinator." });

    const { error } = await deps
      .forUser(token)
      .rpc("lead_assign_coordinator", { p_event_id: req.params.id, p_coordinator_id: coordinatorId });
    if (error) {
      const refusal = ASSIGNMENT_REFUSALS[error.code ?? ""];
      if (refusal) return res.status(refusal.status).json({ error: refusal.error });
      console.error("lead_assign_coordinator failed:", error.message);
      return res.status(500).json({ error: "We couldn't assign the coordinator. Please try again." });
    }
    return res.json({ assigned_coordinator_id: coordinatorId });
  });

  return router;
}
