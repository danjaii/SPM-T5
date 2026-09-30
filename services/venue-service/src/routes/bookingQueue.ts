import { Router } from "express";
import { asyncHandler } from "../middlewares/errors";
import type { SessionUser } from "../middlewares/session";
import type { PortsFactory } from "../ports";
import { QueueService } from "../services/queueService";

/** SCRUM-37: the Venue Staff queue. Session middleware is mounted by the caller. */
export function bookingQueueRoutes(portsFor: PortsFactory) {
  const router = Router();

  async function context(user: SessionUser) {
    const ports = portsFor(user.token);
    const role = await ports.roles.roleOf(user.id);
    return { caller: { id: user.id, role }, queue: new QueueService(ports) };
  }

  // 37-S1 to S5, S7: pending requests, first come first served. No caching, so a fresh decision leaves the list on reload.
  router.get(
    "/booking-queue",
    asyncHandler(async (_req, res) => {
      const { caller, queue } = await context(res.locals.user as SessionUser);
      res.set("Cache-Control", "no-store").json(await queue.list(caller));
    }),
  );

  // 37-S6, S7: one request by id.
  router.get(
    "/booking-queue/:id",
    asyncHandler(async (req, res) => {
      const { caller, queue } = await context(res.locals.user as SessionUser);
      res.set("Cache-Control", "no-store").json(await queue.detail(caller, String(req.params.id)));
    }),
  );

  return router;
}
