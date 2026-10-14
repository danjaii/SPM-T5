import type { NextFunction, Request, Response } from "express";
import { isLead } from "@spm-t5/shared";
import { lookUpRole } from "../routes/events";
import type { SupabaseDeps } from "../supabase";
import type { SessionUser } from "./session";

/**
 * SCRUM-75/AC6 + AC7: Lead pages and actions are for Event Coordinator Leads only. Goes after requireSession. This
 * refuses everyone else before the route runs; RLS on the tables the routes touch is the backstop.
 */
export function requireLead(deps: SupabaseDeps) {
  return async (_req: Request, res: Response, next: NextFunction) => {
    const role = await lookUpRole(deps, res.locals.user as SessionUser);
    if (!isLead(role)) return res.status(403).json({ error: "Only an Event Coordinator Lead can do this." });
    next();
  };
}
