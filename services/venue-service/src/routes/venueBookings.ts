import { Router } from "express";
import { utcToSgt } from "@spm-t5/shared";
import { toBookingDto, toCancelledBookingDto, toDecisionDto, toSubmittedBookingDto } from "../domain/dto";
import { asyncHandler } from "../middlewares/errors";
import type { SessionUser } from "../middlewares/session";
import type { PortsFactory } from "../ports";
import { assertMayRequestFor, BookingService } from "../services/bookingService";
import type { VenueSearchReader } from "../readers/venueSearchReader";
import { DecisionService } from "../services/decisionService";
import { ReplacementService } from "../services/replacementService";
import { TrackingService } from "../services/trackingService";

/** Routes for SCRUM-32 (submit), SCRUM-33 (track), SCRUM-38 (approve) and SCRUM-39 (reject). Session middleware is mounted by the caller. */
export function venueBookingRoutes(portsFor: PortsFactory, now: () => Date, searchFor: (accessToken: string) => VenueSearchReader) {
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
      decisions: new DecisionService({ ...ports, now }),
      // the search reader is only built when a replacement is asked for, so other requests never touch it
      replacements: new ReplacementService({
        ...ports,
        now,
        search: {
          availableVenueIds: (start, end) => searchFor(user.token).availableVenueIds(start, end),
          activeVenues: () => searchFor(user.token).activeVenues(),
          options: () => searchFor(user.token).options(),
        },
      }),
    };
  }

  // 32-S1: submit.
  router.post(
    "/venue-bookings",
    asyncHandler(async (req, res) => {
      const { caller, service } = await context(res.locals.user as SessionUser);
      res.status(201).json(toSubmittedBookingDto(await service.submit(caller, req.body)));
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

  // 102-S1: change one venue booking's date, times, attendance or requirements; it goes back to PENDING.
  router.patch(
    "/venue-bookings/:id",
    asyncHandler(async (req, res) => {
      const { caller, service } = await context(res.locals.user as SessionUser);
      res.json(toSubmittedBookingDto(await service.change(caller, String(req.params.id), req.body)));
    }),
  );

  // 102-S12: cancel one pending or approved venue booking, with a reason (body { reason }).
  router.post(
    "/venue-bookings/:id/cancel",
    asyncHandler(async (req, res) => {
      const { caller, service } = await context(res.locals.user as SessionUser);
      res.json(toCancelledBookingDto(await service.cancel(caller, String(req.params.id), req.body)));
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
      res.status(201).json(toSubmittedBookingDto(await service.amend(caller, String(req.params.id), req.body)));
    }),
  );

  // 59-S1: accept the suggested alternative in one action.
  router.post(
    "/venue-bookings/:id/accept-suggestion",
    asyncHandler(async (req, res) => {
      const { caller, service } = await context(res.locals.user as SessionUser);
      res.status(201).json(toSubmittedBookingDto(await service.acceptSuggestion(caller, String(req.params.id), req.body)));
    }),
  );

  // 107-S1: the venues that could replace a booking flagged as unavailable.
  router.get(
    "/venue-bookings/:id/replacement-candidates",
    asyncHandler(async (req, res) => {
      const { caller, replacements } = await context(res.locals.user as SessionUser);
      res.set("Cache-Control", "no-store").json(await replacements.candidates(caller, String(req.params.id)));
    }),
  );

  // 107-S2: request a replacement for a flagged booking; body { venueId, overrideReason? }.
  router.post(
    "/venue-bookings/:id/replacement",
    asyncHandler(async (req, res) => {
      const { caller, replacements } = await context(res.locals.user as SessionUser);
      const original = String(req.params.id);
      res.status(201).json({ ...toSubmittedBookingDto(await replacements.replace(caller, original, req.body)), replaces: original });
    }),
  );

  // 38-S1: Venue Staff approve a pending request.
  router.post(
    "/venue-bookings/:id/approve",
    asyncHandler(async (req, res) => {
      const { caller, decisions } = await context(res.locals.user as SessionUser);
      res.json(toDecisionDto(await decisions.approve(caller, String(req.params.id))));
    }),
  );

  // 39-S1: Venue Staff reject a pending request, with a reason (body { reason }).
  router.post(
    "/venue-bookings/:id/reject",
    asyncHandler(async (req, res) => {
      const { caller, decisions } = await context(res.locals.user as SessionUser);
      res.json(toDecisionDto(await decisions.reject(caller, String(req.params.id), req.body)));
    }),
  );

  // 38-S4: the venue booking an event ended up with, for its assigned Coordinator. Null until approved.
  router.get(
    "/events/:eventId/venue-booking",
    asyncHandler(async (req, res) => {
      const { caller, decisions } = await context(res.locals.user as SessionUser);
      res.set("Cache-Control", "no-store").json(await decisions.approvedBookingFor(caller, String(req.params.eventId)));
    }),
  );

  // 98-S21: every booking of one event, for its assigned Coordinator. No caching, so a fresh decision shows on reload.
  router.get(
    "/events/:eventId/venue-bookings",
    asyncHandler(async (req, res) => {
      const { caller, tracking } = await context(res.locals.user as SessionUser);
      res.set("Cache-Control", "no-store").json(await tracking.forEvent(caller, String(req.params.eventId)));
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
