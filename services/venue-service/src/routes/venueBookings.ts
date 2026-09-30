import { Router } from "express";
import { utcToSgt } from "@spm-t5/shared";
import { toBookingDto } from "../domain/dto";
import { asyncHandler } from "../middlewares/errors";
import type { SessionUser } from "../middlewares/session";
import type { PortsFactory } from "../ports";
import { assertMayRequestFor, BookingService } from "../services/bookingService";

/** Routes for SCRUM-32 (submit). Session middleware is mounted by the caller. */
export function venueBookingRoutes(portsFor: PortsFactory, now: () => Date) {
  const router = Router();

  /** Builds the service and the caller (with role) for this request. */
  async function context(user: SessionUser) {
    const ports = portsFor(user.token);
    const role = await ports.roles.roleOf(user.id);
    return { ports, caller: { id: user.id, role }, service: new BookingService({ ...ports, now }) };
  }

  // 32-S1: submit.
  router.post(
    "/venue-bookings",
    asyncHandler(async (req, res) => {
      const { caller, service } = await context(res.locals.user as SessionUser);
      const booking = await service.submit(caller, req.body);
      res.status(201).json(toBookingDto(booking));
    }),
  );

  // 32-S2: pre-fill for the request form. Same access rules as submitting.
  router.get(
    "/events/:eventId/venue-booking-form",
    asyncHandler(async (req, res) => {
      const { ports, caller } = await context(res.locals.user as SessionUser);
      const event = assertMayRequestFor(caller, await ports.events.getById(String(req.params.eventId)));
      const start = event.proposedStart ? utcToSgt(event.proposedStart) : null;
      res.json({
        eventId: event.id,
        eventName: event.name,
        date: start?.date ?? null,
        startTime: start?.time ?? null,
        endTime: event.proposedEnd ? utcToSgt(event.proposedEnd).time : null,
        // Read-only on the form (32-S2): they are copied from the event at submission.
        expectedAttendance: event.expectedAttendance,
        venueRequirements: event.venueRequirements,
        accessibilityNeeds: event.accessibilityNeeds,
      });
    }),
  );

  // Minimal venue list for the form's picker (SCRUM-29 owns the full catalogue).
  router.get(
    "/venues",
    asyncHandler(async (_req, res) => {
      const { ports } = await context(res.locals.user as SessionUser);
      res.json(await ports.venues.listActive());
    }),
  );

  return router;
}
