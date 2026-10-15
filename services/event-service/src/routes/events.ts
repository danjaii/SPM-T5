import { Router, type Request, type Response } from "express";
import { attachmentProblem, canDecideEvent, canRequestChange, canReviewEvents, isEventStatus, isRole, type Role } from "@spm-t5/shared";
import type { SupabaseDeps } from "../supabase";
import { requireSession, type SessionUser } from "../middlewares/session";

/** Looks up the caller's role in the users table; undefined if missing or not a real role. */
export async function lookUpRole(deps: SupabaseDeps, { id, token }: SessionUser): Promise<Role | undefined> {
  const { data: profile } = await deps.forUser(token).from("users").select("role").eq("id", id).maybeSingle();
  return isRole(profile?.role) ? profile.role : undefined;
}

/** The event's organiser, or undefined when there is no such event. */
async function eventOrganiserId(deps: SupabaseDeps, token: string, eventId: unknown): Promise<string | undefined> {
  const { data: event } = await deps.forUser(token).from("events").select("organiser_id").eq("id", eventId).maybeSingle();
  return event ? (event.organiser_id as string) : undefined;
}

// SCRUM-44/AC5: statuses in which a request is still waiting on the organiser or the coordinator.
const AWAITING_DECISION = ["draft", "submitted", "under_review", "returned"];

// SCRUM-78/AC9: refusal shown to a coordinator who tries to claim an unassigned event (Leads assign those now).
const LEAD_ASSIGNS_UNASSIGNED = "Only an Event Coordinator Lead can assign a coordinator to an unassigned event.";
// SCRUM-79/AC9: refusal shown to a coordinator who tries to hand their event over (Leads reassign now).
const LEAD_REASSIGNS = "Only an Event Coordinator Lead can reassign a coordinator.";

/**
 * SCRUM-24: why the caller may not decide on this event, as an HTTP status and message; undefined if they may.
 * Only the assigned coordinator (AC5) may decide, and only while the request is awaiting a decision (AC1, AC2).
 */
async function decisionRefusal(
  deps: SupabaseDeps,
  { id: userId, token }: SessionUser,
  eventId: unknown,
): Promise<{ status: number; error: string } | undefined> {
  const { data: event } = await deps
    .forUser(token)
    .from("events")
    .select("status, assigned_coordinator_id")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return { status: 404, error: "Event not found." };
  if (event.assigned_coordinator_id !== userId) {
    return { status: 403, error: "Only the coordinator assigned to this event can approve or reject it." };
  }
  if (!canDecideEvent(event.status as string)) {
    return { status: 409, error: "Only submitted or under-review requests can be approved or rejected." };
  }
  return undefined;
}

/** The event fields GET /events/:id selects. Typed by hand because the project has no generated database types. */
interface EventDetailRow {
  id: string;
  name: string;
  status: string;
  purpose: string | null;
  preferred_start_datetime: string | null;
  preferred_end_datetime: string | null;
  expected_attendance: number | null;
  preferred_room_layout: unknown;
  accessibility_requirements: string | null;
  equipment_requirements_notes: string | null;
  submitted_at: string | null;
  assigned_coordinator_id: string | null;
  organiser: unknown;
}

/**
 * The full_name of an embedded user row (e.g. organiser:organiser_id(full_name)). Without generated
 * types Supabase describes an embed as an array; at runtime it is a single object, so accept both.
 */
function embeddedName(value: unknown): string | null {
  const row = Array.isArray(value) ? value[0] : value;
  const name = (row as { full_name?: unknown } | null | undefined)?.full_name;
  return typeof name === "string" ? name : null;
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
        const organiserMatch = embeddedName(e.organiser)?.toLowerCase().includes(search) ?? false;
        return nameMatch || organiserMatch;
      })
      .map((e) => ({
        id: e.id,
        name: e.name,
        status: e.status,
        submitted_at: e.submitted_at,
        organiser_name: embeddedName(e.organiser),
      }));
    return res.json(response);
  });

  // SCRUM-42/AC4: list events assigned to the calling coordinator
  router.get("/my-events", requireSession(deps), async (req, res) => {
    const { id: userId, token } = res.locals.user as SessionUser;
    const role = await lookUpRole(deps, res.locals.user as SessionUser);
    if (role === undefined || !canReviewEvents(role)) {
      return res.status(403).json({ error: "You are not allowed to view your assigned events." });
    }
    const { data: events } = await deps
      .forUser(token)
      .from("events")
      .select("id, name, status")
      .eq("assigned_coordinator_id", userId);
    return res.json(
      (events ?? []).map((e) => ({ id: e.id, name: e.name, status: e.status })),
    );
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
        "assigned_coordinator_id, organiser:organiser_id(full_name)"
      )
      .eq("id", req.params.id);

    // SCRUM-7 AC3: an organiser only sees events they submitted
    if (isOrganiser) query = query.eq("organiser_id", userId);

    const { data: event } = await query.maybeSingle<EventDetailRow>();

    // SCRUM-7 AC3: someone else's event looks exactly like one that doesn't exist
    if (!event) return res.status(404).json({ error: "Event not found." });

    // For the UI: whether this viewer may change the status (SCRUM-8 AC4 + AC6), so the page knows to show the dropdown
    const canChangeStatus = isCoordinator && event.assigned_coordinator_id === userId;
    // SCRUM-24/AC5: only the assigned coordinator may approve or reject; the UI also needs canDecideEvent(status)
    const canReview = canChangeStatus;
    // SCRUM-42/AC5: look up the assigned coordinator's name as the organiser's point of contact
    let pointOfContactName: string | null = null;
    if (event.assigned_coordinator_id) {
      const { data: poc } = await deps
        .forUser(token)
        .from("users")
        .select("full_name")
        .eq("id", event.assigned_coordinator_id)
        .maybeSingle();
      pointOfContactName = (poc?.full_name as string | null) ?? null;
    }

    res.json({
      id: event.id,
      name: event.name,
      status: event.status,
      canChangeStatus,
      canReview,
      // SCRUM-66/AC1-AC3: for the UI, whether this viewer is the organiser and may raise a change request now
      isOrganiser,
      canRequestChange: isOrganiser && canRequestChange(event.status),
      purpose: (event.purpose as string | null) ?? null,
      preferred_start_datetime: (event.preferred_start_datetime as string | null) ?? null,
      preferred_end_datetime: (event.preferred_end_datetime as string | null) ?? null,
      expected_attendance: (event.expected_attendance as number | null) ?? null,
      preferred_layout_name: (event.preferred_room_layout as { name: string } | null)?.name ?? null,
      accessibility_requirements: (event.accessibility_requirements as string | null) ?? null,
      equipment_requirements_notes: (event.equipment_requirements_notes as string | null) ?? null,
      submitted_at: (event.submitted_at as string | null) ?? null,
      organiser_name: embeddedName(event.organiser),
      point_of_contact_name: pointOfContactName,
    });
  });

  // SCRUM-44: the review outcome of an event request — the coordinator's approve/reject decision, its reason and
  // when it was made. AC6: the same people as GET /:id (coordinators; organisers for their own events only).
  router.get("/:id/outcome", requireSession(deps), async (req, res) => {
    const { id: userId, token } = res.locals.user as SessionUser;
    const role = await lookUpRole(deps, res.locals.user as SessionUser);
    const isCoordinator = role !== undefined && canReviewEvents(role);
    const isOrganiser = role === "event_organiser";
    if (!isCoordinator && !isOrganiser) {
      return res.status(403).json({ error: "You are not allowed to view this event's review outcome." });
    }

    let query = deps.forUser(token).from("events").select("id, status").eq("id", req.params.id);
    if (isOrganiser) query = query.eq("organiser_id", userId);
    const { data: event } = await query.maybeSingle();
    // AC6: someone else's event looks exactly like one that doesn't exist
    if (!event) return res.status(404).json({ error: "Event not found." });

    // AC5: while the request is still with the organiser or the coordinator, there is no decision to show,
    // even if an older one exists (e.g. it was returned and resubmitted after a decision)
    if (AWAITING_DECISION.includes(event.status as string)) return res.json({ decision: null });

    const { data: history } = await deps
      .forUser(token)
      .from("event_status_history")
      .select("new_status, reason, changed_at, changed_by")
      .eq("event_id", req.params.id)
      .in("new_status", ["approved", "rejected"])
      .order("changed_at", { ascending: false });
    const latest = history?.[0];
    // e.g. cancelled before anyone decided
    if (!latest) return res.json({ decision: null });

    let decidedByName: string | null = null;
    if (latest.changed_by) {
      const { data: who } = await deps
        .forUser(token)
        .from("users")
        .select("full_name")
        .eq("id", latest.changed_by)
        .maybeSingle();
      decidedByName = (who?.full_name as string | null) ?? null;
    }

    // AC1-AC4: outcome, when, the reason (rejections always have one; approvals may not) and who decided
    return res.json({
      decision: {
        outcome: latest.new_status,
        decided_at: latest.changed_at,
        reason: (latest.reason as string | null) ?? null,
        decided_by_name: decidedByName,
      },
    });
  });

  // SCRUM-24/AC2: the assigned coordinator rejects a submitted event request with a mandatory reason
  router.post("/:id/reject", requireSession(deps), async (req, res) => {
    const { token } = res.locals.user as SessionUser;
    const role = await lookUpRole(deps, res.locals.user as SessionUser);
    if (role === undefined || !canReviewEvents(role)) {
      return res.status(403).json({ error: "You are not allowed to reject this event." });
    }
    const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
    if (!reason) {
      return res.status(400).json({ error: "A reason is required to reject an event." });
    }
    const refusal = await decisionRefusal(deps, res.locals.user as SessionUser, req.params.id);
    if (refusal) return res.status(refusal.status).json({ error: refusal.error });
    const { data: event } = await deps
      .forUser(token)
      .rpc("change_event_status", {
        p_event_id: req.params.id,
        p_new_status: "rejected",
        p_reason: reason,
      })
      .maybeSingle();
    if (!event) return res.status(404).json({ error: "Event not found." });
    return res.json(event);
  });

  // SCRUM-24/AC1: the assigned coordinator approves a submitted event request
  router.post("/:id/approve", requireSession(deps), async (req, res) => {
    const { token } = res.locals.user as SessionUser;
    const role = await lookUpRole(deps, res.locals.user as SessionUser);
    if (role === undefined || !canReviewEvents(role)) {
      return res.status(403).json({ error: "You are not allowed to approve this event." });
    }
    const refusal = await decisionRefusal(deps, res.locals.user as SessionUser, req.params.id);
    if (refusal) return res.status(refusal.status).json({ error: refusal.error });
    const { data: event } = await deps
      .forUser(token)
      .rpc("change_event_status", {
        p_event_id: req.params.id,
        p_new_status: "approved",
        p_reason: null,
      })
      .maybeSingle();
    if (!event) return res.status(404).json({ error: "Event not found." });
    return res.json(event);
  });

  // SCRUM-28/AC6: get a short-lived signed URL to open or download a stored attachment
  router.get("/:id/attachments/signed-url", requireSession(deps), async (req, res) => {
    const { token } = res.locals.user as SessionUser;
    const role = await lookUpRole(deps, res.locals.user as SessionUser);
    if (role === undefined || (!canReviewEvents(role) && role !== "event_organiser")) {
      return res.status(403).json({ error: "You are not allowed to access attachments on this event." });
    }
    const storagePath = typeof req.query.storage_path === "string" ? req.query.storage_path.trim() : "";
    if (!storagePath) {
      return res.status(400).json({ error: "storage_path is required." });
    }
    const { data } = await deps.forUser(token).storage
      .from("event-attachments")
      .createSignedUrl(storagePath, 3600);
    if (!data?.signedUrl) {
      return res.status(500).json({ error: "Could not generate a signed URL." });
    }
    return res.json({ signed_url: data.signedUrl });
  });

  // SCRUM-28/AC1: a one-time URL the browser uploads one staged file to, before posting the comment with it.
  // SCRUM-28/AC4-AC6: the file's type and size are checked first (the bucket enforces the same on upload).
  // The URL is created as the caller, so the bucket's insert policy (who can see the event) applies.
  router.post("/:id/attachments/upload-url", requireSession(deps), async (req, res) => {
    const { id: callerId, token } = res.locals.user as SessionUser;
    const role = await lookUpRole(deps, res.locals.user as SessionUser);
    if (role === undefined || (!canReviewEvents(role) && role !== "event_organiser")) {
      return res.status(403).json({ error: "You are not allowed to attach files on this event." });
    }
    const fileName = typeof req.body.file_name === "string" ? req.body.file_name.trim() : "";
    const contentType = typeof req.body.content_type === "string" ? req.body.content_type : "";
    const size = typeof req.body.size === "number" ? req.body.size : NaN;
    if (!fileName || !Number.isFinite(size) || size < 0) {
      return res.status(400).json({ error: "file_name, content_type and size are required." });
    }
    const problem = attachmentProblem({ type: contentType, size });
    if (problem) return res.status(400).json({ error: problem });

    const organiserId = await eventOrganiserId(deps, token, req.params.id);
    if (organiserId === undefined) return res.status(404).json({ error: "Event not found." });
    if (role === "event_organiser" && organiserId !== callerId) {
      return res.status(403).json({ error: "You are not allowed to attach files on this event." });
    }
    // <event id>/<random>/<name>: the event folder is what the storage policy checks; the random folder keeps
    // two files with the same name apart
    const safeName = fileName.replace(/[^\w.-]+/g, "_").slice(-100);
    const storagePath = `${req.params.id}/${crypto.randomUUID()}/${safeName}`;
    const { data } = await deps.forUser(token).storage.from("event-attachments").createSignedUploadUrl(storagePath);
    if (!data?.signedUrl) {
      return res.status(500).json({ error: "Could not prepare the upload. Please try again." });
    }
    return res.json({ upload_url: data.signedUrl, storage_path: storagePath });
  });

  // SCRUM-25/AC2: an authorised user views comment details (author name, date/time, text)
  // SCRUM-25/AC5: response includes can_comment so the UI can show/hide the comment input
  // SCRUM-27/AC3: each comment includes a mentions array with user_id and full_name
  router.get("/:id/comments", requireSession(deps), async (req, res) => {
    const { token } = res.locals.user as SessionUser;
    const role = await lookUpRole(deps, res.locals.user as SessionUser);
    if (role === undefined || (!canReviewEvents(role) && role !== "event_organiser")) {
      return res.status(403).json({ error: "You are not allowed to view comments on this event." });
    }
    const { data: comments } = await deps
      .forUser(token)
      .from("event_comments")
      .select("id, comment_text, created_at, parent_comment_id, author:author_id(full_name)")
      .eq("event_id", req.params.id)
      .order("created_at", { ascending: true });

    const commentIds = (comments ?? []).map((c) => c.id as string);
    const mentionsByComment = new Map<string, Array<{ user_id: string; full_name: string | null }>>();
    if (commentIds.length > 0) {
      const { data: mentionRows } = await deps
        .forUser(token)
        .from("event_comment_mentions")
        .select("comment_id, user_id")
        .in("comment_id", commentIds);
      const mentionedUserIds = [...new Set((mentionRows ?? []).map((m) => m.user_id as string))];
      let userMap = new Map<string, string>();
      if (mentionedUserIds.length > 0) {
        const { data: users } = await deps
          .forUser(token)
          .from("users")
          .select("id, full_name")
          .in("id", mentionedUserIds);
        userMap = new Map((users ?? []).map((u) => [u.id as string, u.full_name as string]));
      }
      for (const m of mentionRows ?? []) {
        const cid = m.comment_id as string;
        if (!mentionsByComment.has(cid)) mentionsByComment.set(cid, []);
        mentionsByComment.get(cid)!.push({
          user_id: m.user_id as string,
          full_name: userMap.get(m.user_id as string) ?? null,
        });
      }
    }

    const attachmentsByComment = new Map<string, Array<{ file_name: string; storage_path: string }>>();
    if (commentIds.length > 0) {
      const { data: attachmentRows } = await deps
        .forUser(token)
        .from("event_comment_attachments")
        .select("comment_id, file_name, storage_path")
        .in("comment_id", commentIds);
      for (const a of attachmentRows ?? []) {
        const cid = a.comment_id as string;
        if (!attachmentsByComment.has(cid)) attachmentsByComment.set(cid, []);
        attachmentsByComment.get(cid)!.push({
          file_name: a.file_name as string,
          storage_path: a.storage_path as string,
        });
      }
    }

    const can_comment = canReviewEvents(role) || role === "event_organiser";
    return res.json({
      can_comment,
      comments: (comments ?? []).map((c) => ({
        id: c.id,
        body: c.comment_text,
        created_at: c.created_at,
        parent_comment_id: (c.parent_comment_id as string | null) ?? null,
        author_name: embeddedName(c.author),
        mentions: mentionsByComment.get(c.id as string) ?? [],
        attachments: attachmentsByComment.get(c.id as string) ?? [],
      })),
    });
  });

  // SCRUM-25/AC1: an authorised user adds a comment to an event
  // SCRUM-27/AC2: @[userId] markers in the body are extracted and persisted as mention records
  router.post("/:id/comments", requireSession(deps), async (req, res) => {
    const { id: authorId, token } = res.locals.user as SessionUser;
    const role = await lookUpRole(deps, res.locals.user as SessionUser);
    if (role === undefined || (!canReviewEvents(role) && role !== "event_organiser")) {
      return res.status(403).json({ error: "You are not allowed to comment on this event." });
    }
    const body = typeof req.body.body === "string" ? req.body.body.trim() : "";
    if (!body) {
      return res.status(400).json({ error: "Comment text is required." });
    }
    const parentCommentId = typeof req.body.parent_comment_id === "string" ? req.body.parent_comment_id : null;
    const commentId = crypto.randomUUID();
    await deps.forUser(token).from("event_comments").insert({
      id: commentId,
      event_id: req.params.id,
      author_id: authorId,
      comment_text: body,
      ...(parentCommentId !== null && { parent_comment_id: parentCommentId }),
    });
    const mentionedIds = [...body.matchAll(/@\[([^\]]+)\]/g)].map((m) => m[1]);
    for (const userId of mentionedIds) {
      await deps.forUser(token).from("event_comment_mentions").insert({ comment_id: commentId, user_id: userId });
    }
    const attachments = Array.isArray(req.body.attachments) ? req.body.attachments : [];
    for (const att of attachments) {
      if (typeof att?.file_name === "string" && typeof att?.storage_path === "string") {
        await deps.forUser(token).from("event_comment_attachments").insert({
          comment_id: commentId,
          file_name: att.file_name,
          storage_path: att.storage_path,
        });
      }
    }
    return res.status(201).json({});
  });

  // SCRUM-27/AC1: search for users eligible to access the request
  // SCRUM-27/AC5: that is the coordinators and this event's own organiser (as user_can_access_event in
  // migration 08 decides), never another event's organiser; the caller isn't offered to themselves
  router.get("/:id/mentionable-users", requireSession(deps), async (req, res) => {
    const { id: callerId, token } = res.locals.user as SessionUser;
    const role = await lookUpRole(deps, res.locals.user as SessionUser);
    if (role === undefined || (!canReviewEvents(role) && role !== "event_organiser")) {
      return res.status(403).json({ error: "You are not allowed to search for users on this event." });
    }
    const organiserId = await eventOrganiserId(deps, token, req.params.id);
    if (organiserId === undefined) return res.status(404).json({ error: "Event not found." });
    if (role === "event_organiser" && organiserId !== callerId) {
      return res.status(403).json({ error: "You are not allowed to search for users on this event." });
    }
    const query = typeof req.query.query === "string" ? req.query.query.trim().toLowerCase() : "";
    const { data: users } = await deps
      .forUser(token)
      .from("users")
      .select("id, full_name")
      .or(`role.eq.event_coordinator,id.eq.${organiserId}`);
    const result = (users ?? [])
      .filter((u) => {
        if (u.id === callerId) return false;
        if (!query) return true;
        const name = typeof u.full_name === "string" ? u.full_name.toLowerCase() : "";
        return name.includes(query);
      })
      .map((u) => ({ id: u.id, full_name: u.full_name }));
    return res.json(result);
  });

  /**
   * SCRUM-78/AC9 + SCRUM-79/AC9: coordinators no longer assign (SCRUM-42) or reassign (SCRUM-41) events; a Lead does,
   * from /lead (routes/lead.ts). These two routes are kept so a coordinator who calls them is told why, not sent a 404;
   * the database refuses the change too (events_assignment_guard, migrations 23-24).
   */
  const refuseCoordinatorAssignment = (notAllowed: string) => async (req: Request, res: Response) => {
    const role = await lookUpRole(deps, res.locals.user as SessionUser);
    if (role === undefined || !canReviewEvents(role)) return res.status(403).json({ error: notAllowed });
    const { data: event } = await deps
      .forUser((res.locals.user as SessionUser).token)
      .from("events")
      .select("assigned_coordinator_id")
      .eq("id", req.params.id)
      .maybeSingle();
    if (!event) return res.status(404).json({ error: "Event not found." });
    return res.status(403).json({ error: event.assigned_coordinator_id ? LEAD_REASSIGNS : LEAD_ASSIGNS_UNASSIGNED });
  };

  router.get("/:id/eligible-coordinators", requireSession(deps), refuseCoordinatorAssignment("You are not allowed to view eligible coordinators."));

  // SCRUM-43/AC1: view coordinator assignment history for an event
  router.get("/:id/assignment-history", requireSession(deps), async (req, res) => {
    const { token } = res.locals.user as SessionUser;
    const role = await lookUpRole(deps, res.locals.user as SessionUser);
    const isCoordinator = role !== undefined && canReviewEvents(role);
    const isOrganiser = role === "event_organiser";
    if (!isCoordinator && !isOrganiser) {
      return res.status(403).json({ error: "You are not allowed to view this event's assignment history." });
    }
    const { data: logs } = await deps
      .forUser(token)
      .from("coordinator_assignment_logs")
      .select("event_id, coordinator_id, previous_coordinator_id, assigned_by, assigned_at")
      .eq("event_id", req.params.id)
      .order("assigned_at", { ascending: true });

    // SCRUM-43/AC2: names for display, looked up in one query (people may since have been deactivated)
    const ids = [...new Set((logs ?? []).flatMap((l) => [l.coordinator_id, l.previous_coordinator_id, l.assigned_by]))]
      .filter((id): id is string => typeof id === "string");
    const { data: people } = ids.length
      ? await deps.forUser(token).from("users").select("id, full_name").in("id", ids)
      : { data: [] };
    const nameOf = new Map((people ?? []).map((p) => [p.id as string, p.full_name as string | null]));
    const name = (id: unknown) => (typeof id === "string" ? nameOf.get(id) ?? null : null);

    return res.json(
      (logs ?? []).map((l) => ({
        ...l,
        coordinator_name: name(l.coordinator_id),
        previous_coordinator_name: name(l.previous_coordinator_id),
        assigned_by_name: name(l.assigned_by),
      })),
    );
  });

  router.post("/:id/assign-coordinator", requireSession(deps), refuseCoordinatorAssignment("You are not allowed to assign coordinators."));

  // SCRUM-8: an event coordinator changes an event's status
  router.patch("/:id/status", requireSession(deps), async (req, res) => {
    const { id: userId, token } = res.locals.user as SessionUser;

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

    // SCRUM-8 AC6: only the coordinator assigned to this event may change its status
    const { data: target } = await deps
      .forUser(token)
      .from("events")
      .select("assigned_coordinator_id")
      .eq("id", req.params.id)
      .maybeSingle();
    if (!target) return res.status(404).json({ error: "Event not found." });
    if (target.assigned_coordinator_id !== userId) {
      return res.status(403).json({ error: "Only the coordinator assigned to this event can change its status." });
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

    // SCRUM-8 AC2: confirm the change by sending back the updated event
    res.json(event);
  });

  return router;
}
