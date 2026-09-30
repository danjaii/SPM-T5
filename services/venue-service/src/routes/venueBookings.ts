import { Router } from "express";
import { utcToSgt } from "@spm-t5/shared";
import { toBookingDto } from "../domain/dto";
import { asyncHandler } from "../middlewares/errors";
import type { SessionUser } from "../middlewares/session";
import type { PortsFactory } from "../ports";
import { assertMayRequestFor, BookingService } from "../services/bookingService";
import { TrackingService } from "../services/trackingService";

/** Routes for SCRUM-32 (submit) and SCRUM-33 (track). Session middleware is mounted by the caller. */
export function venueBookingRoutes(portsFor: PortsFactory, now: () => Date) {
  const router = Router();

  /** Builds the service and the caller (with role) for this request. */
  async function context(user: SessionUser) {
    const ports = portsFor(user.token);
    const role = await ports.roles.roleOf(user.id);
    return {
      ports,
      caller: { id: user.id, role },
      service: new BookingService({ ...ports, now }),
      tracking: new TrackingService(ports),
    };
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

  // 33-S1, S3, S4, S7: my requests, newest first. No caching, so a fresh decision shows on reload (33-S6).
  router.get(
    "/venue-bookings",
    asyncHandler(async (_req, res) => {
      const { caller, tracking } = await context(res.locals.user as SessionUser);
      res.set("Cache-Control", "no-store").json(await tracking.list(caller));
    }),
  );

  // 33-S2, S5: one request with reason, suggestion and amendment chain.
  router.get(
    "/venue-bookings/:id",
    asyncHandler(async (req, res) => {
      const { caller, tracking } = await context(res.locals.user as SessionUser);
      res.set("Cache-Control", "no-store").json(await tracking.detail(caller, String(req.params.id)));
    }),
  );

  // 35-S1: withdraw a pending request.
  router.post(
    "/venue-bookings/:id/withdraw",
    asyncHandler(async (req, res) => {
      const { caller, service } = await context(res.locals.user as SessionUser);
      const booking = await service.withdraw(caller, String(req.params.id));
      res.json(toBookingDto(booking));
    }),
  );

  // 60-S1: amend a rejected request to a different venue, date or time.
  router.post(
    "/venue-bookings/:id/amend",
    asyncHandler(async (req, res) => {
      const { caller, service } = await context(res.locals.user as SessionUser);
      const booking = await service.amend(caller, String(req.params.id), req.body);
      res.status(201).json(toBookingDto(booking));
    }),
  );

  // 59-S1: accept the suggested alternative in one action.
  router.post(
    "/venue-bookings/:id/accept-suggestion",
    asyncHandler(async (req, res) => {
      const { caller, service } = await context(res.locals.user as SessionUser);
      const booking = await service.acceptSuggestion(caller, String(req.params.id));
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

  return router;
}
