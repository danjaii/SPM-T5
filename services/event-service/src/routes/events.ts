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

  // SCRUM-24/AC2: an authorised coordinator rejects a submitted event request with a mandatory reason
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

  // SCRUM-24/AC1: an authorised coordinator approves a submitted event request
  router.post("/:id/approve", requireSession(deps), async (req, res) => {
    const { token } = res.locals.user as SessionUser;
    const role = await lookUpRole(deps, res.locals.user as SessionUser);
    if (role === undefined || !canReviewEvents(role)) {
      return res.status(403).json({ error: "You are not allowed to approve this event." });
    }
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
    const { data } = await (deps.forUser(token) as any).storage
      .from("event-attachments")
      .createSignedUrl(storagePath, 3600);
    if (!data?.signedUrl) {
      return res.status(500).json({ error: "Could not generate a signed URL." });
    }
    return res.json({ signed_url: data.signedUrl });
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
      .select("id, body, created_at, parent_comment_id, author:author_id(full_name)")
      .eq("event_id", req.params.id)
      .order("created_at", { ascending: true });

    const commentIds = (comments ?? []).map((c) => c.id as string);
    let mentionsByComment = new Map<string, Array<{ user_id: string; full_name: string | null }>>();
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

    let attachmentsByComment = new Map<string, Array<{ file_name: string; storage_path: string }>>();
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
        body: c.body,
        created_at: c.created_at,
        parent_comment_id: (c.parent_comment_id as string | null) ?? null,
        author_name: (c.author as { full_name: string } | null)?.full_name ?? null,
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
      body,
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

  // SCRUM-27/AC1: search for users eligible to access the request (coordinators and organisers)
  router.get("/:id/mentionable-users", requireSession(deps), async (req, res) => {
    const { token } = res.locals.user as SessionUser;
    const role = await lookUpRole(deps, res.locals.user as SessionUser);
    if (role === undefined || (!canReviewEvents(role) && role !== "event_organiser")) {
      return res.status(403).json({ error: "You are not allowed to search for users on this event." });
    }
    const query = typeof req.query.query === "string" ? req.query.query.trim().toLowerCase() : "";
    const { data: users } = await deps
      .forUser(token)
      .from("users")
      .select("id, full_name")
      .or("role.eq.event_coordinator,role.eq.event_organiser");
    const result = (users ?? [])
      .filter((u) => {
        if (!query) return true;
        const name = typeof u.full_name === "string" ? u.full_name.toLowerCase() : "";
        return name.includes(query);
      })
      .map((u) => ({ id: u.id, full_name: u.full_name }));
    return res.json(result);
  });

  // SCRUM-42/AC1: list eligible (active, event_coordinator) coordinators for a given event
  router.get("/:id/eligible-coordinators", requireSession(deps), async (req, res) => {
    const { token } = res.locals.user as SessionUser;
    const role = await lookUpRole(deps, res.locals.user as SessionUser);
    if (role === undefined || !canReviewEvents(role)) {
      return res.status(403).json({ error: "You are not allowed to view eligible coordinators." });
    }
    const { data: coordinators } = await deps
      .forUser(token)
      .from("users")
      .select("id, full_name")
      .eq("role", "event_coordinator")
      .eq("is_active", true);
    return res.json(
      (coordinators ?? []).map((u) => ({ id: u.id, full_name: u.full_name })),
    );
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
