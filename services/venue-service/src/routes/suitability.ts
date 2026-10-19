import { Router } from "express";
import { asyncHandler } from "../middlewares/errors";
import type { SessionUser } from "../middlewares/session";
import type { PortsFactory } from "../ports";
import { availabilityLookup } from "../services/availabilityLookup";
import { SuitabilityService } from "../services/suitabilityService";

/** SCRUM-109: GET /venue-suitability. Session middleware is mounted by the caller (app.ts). */
export function suitabilityRoutes(portsFor: PortsFactory) {
  const router = Router();

  router.get(
    "/venue-suitability",
    asyncHandler(async (req, res) => {
      const user = res.locals.user as SessionUser;
      const ports = portsFor(user.token);
      const role = await ports.roles.roleOf(user.id);
      const service = new SuitabilityService({
        events: ports.events,
        venueDetails: ports.venueDetails,
        availability: availabilityLookup(ports.bookings),
      });
      res.set("Cache-Control", "no-store").json(await service.check({ id: user.id, role }, req.query));
    }),
  );

  return router;
}
