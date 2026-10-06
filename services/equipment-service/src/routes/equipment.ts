import { Router } from "express";
import { asyncHandler } from "../middlewares/errors";
import type { SessionUser } from "../middlewares/session";
import type { PortsFactory } from "../ports";
import { AvailabilityService } from "../services/availabilityService";

/** SCRUM-18: the availability check and the names it suggests. Session middleware is mounted by the caller. */
export function equipmentRoutes(portsFor: PortsFactory, now: () => Date) {
  const router = Router();

  /** Who is asking (18-S13: so the service can refuse anyone who is not Technical Support Staff), and the service. */
  async function context(user: SessionUser) {
    const ports = portsFor(user.token);
    const caller = { id: user.id, role: await ports.roles.roleOf(user.id) };
    return { caller, availability: new AvailabilityService(ports, now) };
  }

  // The catalogue names for the form's suggestions.
  router.get(
    "/equipment",
    asyncHandler(async (_req, res) => {
      const { caller, availability } = await context(res.locals.user as SessionUser);
      res.set("Cache-Control", "no-store").json(await availability.options(caller));
    }),
  );

  // No caching: a reservation approved a minute ago must show up on the next check.
  router.get(
    "/equipment-availability",
    asyncHandler(async (req, res) => {
      const { caller, availability } = await context(res.locals.user as SessionUser);
      res.set("Cache-Control", "no-store").json(await availability.check(caller, req.query));
    }),
  );

  return router;
}
