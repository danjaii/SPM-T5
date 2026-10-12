import { Router } from "express";
import { asyncHandler } from "../middlewares/errors";
import type { SessionUser } from "../middlewares/session";
import type { PortsFactory } from "../ports";
import { AvailabilityService } from "../services/availabilityService";
import { ReservationService } from "../services/reservationService";

/**
 * SCRUM-18: the availability check and the names it suggests. SCRUM-19: reservations.
 * Session middleware is mounted by the caller.
 */
export function equipmentRoutes(portsFor: PortsFactory, now: () => Date) {
  const router = Router();

  /** Who is asking (18-S13: so the service can refuse anyone who is not Technical Support Staff), and the service. */
  async function context(user: SessionUser) {
    const ports = portsFor(user.token);
    const caller = { id: user.id, role: await ports.roles.roleOf(user.id) };
    return {
      caller,
      availability: new AvailabilityService(ports, now),
      reservations: new ReservationService(ports, now),
    };
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

  // SCRUM-19: the events for the reservation form's event dropdown.
  router.get(
    "/reservable-events",
    asyncHandler(async (_req, res) => {
      const { caller, reservations } = await context(res.locals.user as SessionUser);
      res.set("Cache-Control", "no-store").json(await reservations.reservableEvents(caller));
    }),
  );

  // SCRUM-19: reserve equipment for an event. 201 "created" when the reservation is saved.
  router.post(
    "/equipment-reservations",
    asyncHandler(async (req, res) => {
      const { caller, reservations } = await context(res.locals.user as SessionUser);
      res.status(201).json(await reservations.reserve(caller, req.body ?? {}));
    }),
  );

  return router;
}
