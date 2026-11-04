import { Router } from "express";
import { parseCalendarRange } from "@spm-t5/shared";
import { validationFailed } from "../domain/errors";
import { asyncHandler } from "../middlewares/errors";
import type { SessionUser } from "../middlewares/session";
import type { PortsFactory } from "../ports";
import { QueueService } from "../services/queueService";

/** SCRUM-37: the Venue Staff queue. Session middleware is mounted by the caller. */
export function bookingQueueRoutes(portsFor: PortsFactory, now: () => Date = () => new Date()) {
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

  // SCRUM-163: approved bookings starting in ?from..?to (Singapore dates; this week when omitted). Declared before /:id.
  router.get(
    "/booking-queue/schedule",
    asyncHandler(async (req, res) => {
      const parsed = parseCalendarRange(req.query, now());
      if (!parsed.ok) throw validationFailed(parsed.fieldErrors);
      const { caller, queue } = await context(res.locals.user as SessionUser);
      res.set("Cache-Control", "no-store").json(await queue.schedule(caller, parsed.data.start, parsed.data.end));
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
