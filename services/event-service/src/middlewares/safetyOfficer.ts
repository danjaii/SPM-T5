import type { NextFunction, Request, Response } from "express";
import { canMakeSafetyDecision } from "@spm-t5/shared";
import { lookUpRole } from "../routes/events";
import type { SupabaseDeps } from "../supabase";
import type { SessionUser } from "./session";

/**
 * SCRUM-99/AC2: the safety check pages and actions are for Safety Officers only. Goes after requireSession. This refuses
 * everyone else before the route runs; the migration 37 functions refuse them too.
 */
export function requireSafetyOfficer(deps: SupabaseDeps) {
  return async (_req: Request, res: Response, next: NextFunction) => {
    const role = await lookUpRole(deps, res.locals.user as SessionUser);
    if (role === undefined || !canMakeSafetyDecision(role)) {
      return res.status(403).json({ error: "Only a Safety Officer can do this." });
    }
    next();
  };
}
