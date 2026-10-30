import { Router } from "express";
import { canCreateEventRequests } from "@spm-t5/shared";
import type { SupabaseDeps } from "../supabase";
import { requireSession, type SessionUser } from "../middlewares/session";
import { lookUpRole } from "./events";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOT_FOUND = { error: "Draft not found." };
// SCRUM-56/AC2: only a draft can be deleted this way
const NOT_A_DRAFT = { code: "NOT_A_DRAFT", error: "This request has been submitted, so it can no longer be deleted." };

/** SCRUM-56: an event organiser permanently deletes one of their own draft event requests. */
export function eventDraftDeleteRoutes(deps: SupabaseDeps) {
  const router = Router();

  // SCRUM-56/AC1: the delete is made by delete_event_draft() (migration 63, security definer), called as the caller. Nobody has
  // DELETE on events (migration 14), so the function is the only way in and it checks the caller's role, ownership and status itself.
  router.delete("/drafts/:id", requireSession(deps), async (req, res) => {
    const user = res.locals.user as SessionUser;
    const role = await lookUpRole(deps, user);
    if (role === undefined || !canCreateEventRequests(role)) {
      return res.status(403).json({ error: "You are not allowed to delete event requests." });
    }

    const id = String(req.params.id);
    if (!UUID.test(id)) return res.status(404).json(NOT_FOUND);

    const { error } = await deps.forUser(user.token).rpc("delete_event_draft", { p_event_id: id });
    // DR001: not found or not theirs, which the caller cannot tell apart. DR002 (AC2): no longer a draft.
    if (error?.code === "DR001") return res.status(404).json(NOT_FOUND);
    if (error?.code === "DR002") return res.status(409).json(NOT_A_DRAFT);
    if (error) return res.status(500).json({ error: "Could not delete the draft." });

    res.status(204).end();
  });

  return router;
}
