import { Router, type Request, type Response } from "express";
import { coordinatorClash, isClosedEventStatus, totalAttendance, type CoordinatorClash, type CoordinatorEventSlot } from "@spm-t5/shared";
import type { SupabaseDeps } from "../supabase";
import { requireLead } from "../middlewares/lead";
import { requireSession, type SessionUser } from "../middlewares/session";

/** Postgres insufficient_privilege: what the Lead functions raise for a caller or coordinator they won't serve. */
const PG_DENIED = "42501";

/** How the Lead's assignment functions refuse (SQLSTATEs from migrations 23 and 24), and what the Lead is told. */
const ASSIGNMENT_REFUSALS: Record<string, { status: number; error: string }> = {
  [PG_DENIED]: { status: 403, error: "Only an Event Coordinator Lead can do this." }, // SCRUM-78/AC9, SCRUM-79/AC9
  CL001: { status: 409, error: "This event is closed, so its coordinator can't be changed." }, // BR2
  CL002: { status: 409, error: "This event has already been assigned to a coordinator." }, // SCRUM-78/AC5
  CL003: { status: 422, error: "Choose one of your active coordinators." }, // BR4, SCRUM-78/AC7, SCRUM-79/AC6
  CL004: { status: 409, error: "This event has no coordinator yet. Assign one from the unassigned queue." },
  CL005: { status: 403, error: "You can only reassign events held by coordinators you supervise." }, // BR4
  CL006: { status: 409, error: "This coordinator is already assigned to the event." }, // SCRUM-79/AC2
  P0002: { status: 404, error: "Event not found." },
};

interface ChangeEventRow {
  id: string;
  name: string;
  status: string;
  assigned_coordinator_id: string | null;
  preferred_start_datetime: string | null;
  preferred_end_datetime: string | null;
  expected_attendance: number | null;
  submitted_at: string | null;
  organiser: { full_name: string | null } | null;
  coordinator?: { full_name: string | null } | null;
}

interface Coordinator {
  id: string;
  full_name: string;
  workload: number;
}

/** SCRUM-168: a coordinator as the assign and reassign steps offer them, with what helps the Lead choose. */
interface CoordinatorChoice extends Coordinator {
  /** People expected across their active events; null when their events could not be read. */
  total_attendance: number | null;
  clash: CoordinatorClash;
}

/** The event as the assign and reassign steps show it. */
function eventSummary(event: ChangeEventRow) {
  return {
    id: event.id,
    name: event.name,
    status: event.status,
    organiser_name: event.organiser?.full_name ?? null,
    preferred_start_datetime: event.preferred_start_datetime,
    preferred_end_datetime: event.preferred_end_datetime,
    expected_attendance: event.expected_attendance,
    submitted_at: event.submitted_at,
  };
}

/**
 * Event Coordinator Lead pages and actions (docs/specs/event-coordinator-lead-role.md). Every route is behind
 * requireSession + requireLead (SCRUM-75/AC7), and reads or writes as the caller so RLS applies too.
 */
export function leadRoutes(deps: SupabaseDeps) {
  const router = Router();
  router.use(requireSession(deps), requireLead(deps));

  /** The event, as far as RLS lets the Lead see it (unassigned submitted events, and their own team's). */
  const loadEvent = async (token: string, id: string) =>
    (
      await deps
        .forUser(token)
        .from("events")
        .select(
          "id, name, status, assigned_coordinator_id, preferred_start_datetime, preferred_end_datetime, " +
          "expected_attendance, submitted_at, organiser:organiser_id(full_name), coordinator:assigned_coordinator_id(full_name)",
        )
        .eq("id", id)
        .maybeSingle<ChangeEventRow>()
    ).data;

  /** The Lead's eligible coordinators (active and linked to them) with their workload counts; null if it failed. */
  const loadEligible = async (token: string): Promise<Coordinator[] | null> => {
    const { data, error } = await deps.forUser(token).rpc("lead_coordinator_overview");
    if (error) {
      console.error("lead_coordinator_overview failed:", error.message);
      return null;
    }
    return (data ?? []) as Coordinator[];
  };
  /**
   * SCRUM-168/AC1-AC3, AC5: each coordinator with their total expected attendance and whether they clash with `event`, from
   * their active events (lead_coordinator_events(), which the database limits to the Lead's own coordinators). A coordinator
   * whose events can't be read is still offered, marked unavailable: the Lead's choice is never blocked (AC4).
   */
  const withClashes = (token: string, event: ChangeEventRow, coordinators: Coordinator[]): Promise<CoordinatorChoice[]> =>
    Promise.all(
      coordinators.map(async (c) => {
        const { data, error } = await deps.forUser(token).rpc("lead_coordinator_events", { p_coordinator_id: c.id });
        if (error) {
          console.error("lead_coordinator_events failed:", error.message);
          return { ...c, total_attendance: null, clash: { status: "unavailable" } as const };
        }
        const events = (data ?? []) as CoordinatorEventSlot[];
        return { ...c, total_attendance: totalAttendance(events), clash: coordinatorClash(event, events) };
      }),
    );
  const eligibleFailed = (res: Response) => res.status(500).json({ error: "We couldn't load your coordinators. Please try again." });

  /** POST handler that confirms an assignment through `fn`, turning the database's refusals into what the Lead is told. */
  const confirmChange = (fn: string, failure: string) => async (req: Request, res: Response) => {
    const { token } = res.locals.user as SessionUser;
    const coordinatorId = typeof req.body?.coordinator_id === "string" ? req.body.coordinator_id.trim() : "";
    if (!coordinatorId) return res.status(400).json({ error: "Choose a coordinator." });

    const { error } = await deps.forUser(token).rpc(fn, { p_event_id: req.params.id, p_coordinator_id: coordinatorId });
    if (error) {
      const refusal = ASSIGNMENT_REFUSALS[error.code ?? ""];
      if (refusal) return res.status(refusal.status).json({ error: refusal.error });
      console.error(`${fn} failed:`, error.message);
      return res.status(500).json({ error: failure });
    }
    return res.json({ assigned_coordinator_id: coordinatorId });
  };

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

  // SCRUM-126: the figures beside the queue (events this month, the next event, reassignments this week), from lead_queue_summary()
  router.get("/summary", async (_req, res) => {
    const { token } = res.locals.user as SessionUser;
    const { data, error } = await deps.forUser(token).rpc("lead_queue_summary");
    if (error) {
      console.error("lead_queue_summary failed:", error.message);
      return res.status(500).json({ error: "We couldn't load the queue summary. Please try again." });
    }
    return res.json((data as unknown[] | null)?.[0] ?? null);
  });

  // SCRUM-81/AC1, AC3-AC6: the Lead's active coordinators with their workload counts (lead_coordinator_overview())
  router.get("/coordinators", async (_req, res) => {
    const { token } = res.locals.user as SessionUser;
    const coordinators = await loadEligible(token);
    return coordinators ? res.json(coordinators) : eligibleFailed(res);
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
  // coordinators with their workload counts
  router.get("/events/:id/assignment", async (req, res) => {
    const { token } = res.locals.user as SessionUser;
    const event = await loadEvent(token, req.params.id);
    if (!event) return res.status(404).json({ error: "Event not found." });

    const canAssign = event.assigned_coordinator_id === null && !isClosedEventStatus(event.status);
    const coordinators = canAssign ? await loadEligible(token) : [];
    if (!coordinators) return eligibleFailed(res);

    return res.json({ event: eventSummary(event), canAssign, coordinators: await withClashes(token, event, coordinators) });
  });

  // SCRUM-79/AC1, AC2, AC5, AC6: what the reassign step shows: the event, who has it now, whether it can be reassigned,
  // and the Lead's other eligible coordinators (the current one can't be chosen) with their workload counts
  router.get("/events/:id/reassignment", async (req, res) => {
    const { token } = res.locals.user as SessionUser;
    const event = await loadEvent(token, req.params.id);
    if (!event) return res.status(404).json({ error: "Event not found." });

    const current = event.assigned_coordinator_id;
    const canReassign = current !== null && !isClosedEventStatus(event.status);
    const eligible = canReassign ? await loadEligible(token) : [];
    if (!eligible) return eligibleFailed(res);

    return res.json({
      event: eventSummary(event),
      current: current ? { id: current, full_name: event.coordinator?.full_name ?? null } : null,
      canReassign,
      coordinators: await withClashes(token, event, eligible.filter((c) => c.id !== current)),
    });
  });

  // SCRUM-78/AC2-AC9: assign; lead_assign_coordinator() (migration 23) checks everything, atomically
  router.post("/events/:id/assign", confirmChange("lead_assign_coordinator", "We couldn't assign the coordinator. Please try again."));

  // SCRUM-79/AC3-AC9: reassign; lead_reassign_coordinator() (migration 24) checks, changes and records it, atomically
  router.post("/events/:id/reassign", confirmChange("lead_reassign_coordinator", "We couldn't reassign the coordinator. Please try again."));

  return router;
}
