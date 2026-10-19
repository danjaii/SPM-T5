import { Router } from "express";
import { asyncHandler } from "../middlewares/errors";
import type { SessionUser } from "../middlewares/session";
import type { PortsFactory } from "../ports";
import type { TechnicalAssignmentStore } from "../repositories/technicalAssignmentStore";
import { TechnicalAssignmentService } from "../services/technicalAssignmentService";

/**
 * SCRUM-20 (docs/specs/technical-assignment-notifications.md): the event's coordinator assigns Technical Support Staff
 * to support it on-site, changes and cancels the assignments. Session middleware is mounted by the caller.
 */
export function technicalAssignmentRoutes(portsFor: PortsFactory, storeFor: (accessToken: string) => TechnicalAssignmentStore) {
  const router = Router();

  async function context(user: SessionUser) {
    const ports = portsFor(user.token);
    const caller = { id: user.id, role: await ports.roles.roleOf(user.id) };
    return { caller, assignments: new TechnicalAssignmentService(ports, storeFor(user.token)) };
  }

  // AC5: the event's assignments, and what the assign form offers
  router.get(
    "/events/:id/technical-assignments",
    asyncHandler(async (req, res) => {
      const { caller, assignments } = await context(res.locals.user as SessionUser);
      res.set("Cache-Control", "no-store").json(await assignments.forEvent(caller, String(req.params.id)));
    }),
  );

  // AC1: assign; 201 "created"
  router.post(
    "/events/:id/technical-assignments",
    asyncHandler(async (req, res) => {
      const { caller, assignments } = await context(res.locals.user as SessionUser);
      res.status(201).json(await assignments.assign(caller, String(req.params.id), req.body));
    }),
  );

  // AC2: change the venue booking, times or note
  router.patch(
    "/technical-assignments/:id",
    asyncHandler(async (req, res) => {
      const { caller, assignments } = await context(res.locals.user as SessionUser);
      res.json(await assignments.change(caller, String(req.params.id), req.body));
    }),
  );

  // AC3: cancel, with a reason
  router.post(
    "/technical-assignments/:id/cancel",
    asyncHandler(async (req, res) => {
      const { caller, assignments } = await context(res.locals.user as SessionUser);
      res.json(await assignments.cancel(caller, String(req.params.id), req.body));
    }),
  );

  return router;
}
