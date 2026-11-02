import { Router } from "express";
import {
  bookingsAffectedMessage,
  bookingsFlaggedMessage,
  bufferConflictSummary,
  canEditVenueTiming,
  canManageVenueCatalogue,
  canMarkVenueUnavailable,
  parseVenueInput,
  sgtToUtc,
  utcToSgt,
  canViewVenueCatalogue,
  isRole,
  parseUnavailabilityInput,
  parseVenueSearchInput,
  parseVenueTimingInput,
  unavailabilityBlockView,
  type AffectedPairDto,
  type Role,
} from "@spm-t5/shared";
import { forbidden, notFound, validationFailed } from "../domain/errors";
import type { SupabaseDeps } from "../supabase";
import { asyncHandler } from "../middlewares/errors";
import { requireSession, type SessionUser } from "../middlewares/session";
import { SupabaseVenueSearchReader, type VenueSearchReader } from "../readers/venueSearchReader";
import type { BookingRepository } from "../repositories/bookingRepository";
import { SupabaseBookingRepository } from "../repositories/supabaseBookingRepository";
import { SupabaseVenueCatalogueWriter, type VenueCatalogueWriter } from "../readers/venueCatalogueWriter";
import { SupabaseVenueTimingWriter, type AffectedPair, type VenueTimingWriter } from "../readers/venueTimingWriter";
import { SupabaseVenueUnavailabilityStore, type VenueUnavailabilityStore } from "../readers/venueUnavailabilityStore";
import { searchVenues } from "../services/venueSearchService";

/** A venue as Supabase returns it when fetched together with its layouts and facilities (nested). */
interface VenueDetailRow {
  id: string;
  name: string;
  address: string;
  description: string | null;
  max_capacity: number;
  operating_hours_start: string | null;
  operating_hours_end: string | null;
  is_accessible: boolean;
  accessibility_notes: string | null;
  venue_supported_layouts: { max_capacity_for_layout: number; room_layouts: { name: string } }[] | null;
  venue_facilities: { facilities: { name: string } }[] | null;
  setup_minutes: number | null;
  turnaround_minutes: number | null;
}

/** SCRUM-104/AC1: an affected pair as the API shows it, with the sentence Venue Staff are told. */
function toAffectedPairDto(p: AffectedPair): AffectedPairDto {
  const side = (s: AffectedPair["first"] | AffectedPair["second"]) => ({
    bookingId: s.bookingId,
    eventName: s.eventName,
    date: utcToSgt(s.eventStart).date,
    startTime: utcToSgt(s.eventStart).time,
    endTime: utcToSgt(s.eventEnd).time,
  });
  return {
    summary: bufferConflictSummary(
      { name: p.first.eventName, eventStart: p.first.eventStart, occupiedUntil: p.first.occupiedUntil },
      { name: p.second.eventName, eventStart: p.second.eventStart, occupiedFrom: p.second.occupiedFrom },
    ),
    first: { ...side(p.first), occupiedUntil: p.first.occupiedUntil.toISOString() },
    second: { ...side(p.second), occupiedFrom: p.second.occupiedFrom.toISOString() },
  };
}

/** True when YYYY-MM-DD is a day that exists (2026-02-30 does not). */
function isRealDate(date: string): boolean {
  const [year, month, day] = date.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

export function venueRoutes(
  deps: SupabaseDeps,
  searchFor: (accessToken: string) => VenueSearchReader = (token) => new SupabaseVenueSearchReader(deps.forUser(token)),
  now: () => Date = () => new Date(),
  timingFor: (accessToken: string) => VenueTimingWriter = (token) => new SupabaseVenueTimingWriter(deps.forUser(token)),
  occupancyFor: (accessToken: string) => Pick<BookingRepository, "occupiedPeriods"> = (token) => new SupabaseBookingRepository(deps.forUser(token)),
  unavailabilityFor: (accessToken: string) => VenueUnavailabilityStore = (token) => new SupabaseVenueUnavailabilityStore(deps.forUser(token)),
  catalogueFor: (accessToken: string) => VenueCatalogueWriter = (token) => new SupabaseVenueCatalogueWriter(deps.forUser(token)),
) {
  const router = Router();

  // SCRUM-29 AC3 + AC4 + AC6 + AC7: every venue request must come from a signed-in coordinator or venue staff member
  router.use(requireSession(deps), async (_req, res, next) => {
    const { id, token } = res.locals.user as SessionUser;
    const { data: profile } = await deps.forUser(token).from("users").select("role").eq("id", id).maybeSingle();
    if (!isRole(profile?.role) || !canViewVenueCatalogue(profile.role)) {
      return res.status(403).json({ error: "You are not allowed to view the venue catalogue." });
    }
    res.locals.role = profile.role as Role;
    next();
  });

  // SCRUM-29 AC1: list every venue with its name, location (address) and maximum capacity
  router.get("/", async (_req, res) => {
    const { token } = res.locals.user as SessionUser;

    const { data } = await deps.forUser(token).from("venues").select("id, name, address, max_capacity").order("name");

    res.json((data ?? []).map((v) => ({ id: v.id, name: v.name, address: v.address, max_capacity: v.max_capacity })));
  });

  // SCRUM-57: Venue Staff add a venue. The role comes before the body (57-S3), the same shared parser as the form checks
  // the body (57-S2), and create_venue enforces the role again in the database and saves the venue whole (57-S1).
  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const { token } = res.locals.user as SessionUser;
      if (!canManageVenueCatalogue(res.locals.role as Role)) throw forbidden("Only venue staff can add a venue.");

      const parsed = parseVenueInput(req.body);
      if (!parsed.ok) throw validationFailed(parsed.fieldErrors as Record<string, string>);

      res.status(201).json(await catalogueFor(token).create(parsed.data));
    }),
  );

  // SCRUM-65: the layouts and facilities the search form offers. Registered before /:id so it is not read as an id.
  router.get(
    "/search-options",
    asyncHandler(async (_req, res) => {
      const { token } = res.locals.user as SessionUser;
      res.json(await searchFor(token).options());
    }),
  );

  // SCRUM-65: venues free for a date and time that meet every criterion given. Also before /:id.
  router.get(
    "/search",
    asyncHandler(async (req, res) => {
      const { token } = res.locals.user as SessionUser;
      // AC4, AC5, AC6: the same shared checks the search form runs, answered with 422 and a message per field.
      const parsed = parseVenueSearchInput(req.query, now());
      if (!parsed.ok) throw validationFailed(parsed.fieldErrors);
      res.json({ venues: await searchVenues(searchFor(token), parsed.data) });
    }),
  );

  // SCRUM-29 AC2: one venue with all its characteristics, fetched together with its layouts and facilities
  router.get("/:id", asyncHandler(async (req, res) => {
    const { token } = res.locals.user as SessionUser;

    const { data: venue } = await deps
      .forUser(token)
      .from("venues")
      .select(
        "id, name, address, description, max_capacity, operating_hours_start, operating_hours_end, is_accessible, accessibility_notes, setup_minutes, turnaround_minutes, " +
          "venue_supported_layouts(max_capacity_for_layout, room_layouts(name)), venue_facilities(facilities(name))",
      )
      .eq("id", req.params.id)
      .maybeSingle<VenueDetailRow>();
    if (!venue) return res.status(404).json({ error: "Venue not found." });

    // SCRUM-105: the blocks that have not ended, earliest first. Only venue staff get the notes and who made them (105-S6).
    const forStaff = canMarkVenueUnavailable(res.locals.role as Role);
    const upcoming = (await unavailabilityFor(token).list(venue.id, forStaff)).filter((b) => b.end.getTime() > now().getTime());

    // Flatten the nested layouts/facilities into simple lists the web app can show directly
    res.json({
      id: venue.id,
      name: venue.name,
      address: venue.address,
      description: venue.description,
      max_capacity: venue.max_capacity,
      operating_hours_start: venue.operating_hours_start,
      operating_hours_end: venue.operating_hours_end,
      is_accessible: venue.is_accessible,
      accessibility_notes: venue.accessibility_notes,
      // SCRUM-101: 0 until Venue Staff set them; only Venue Staff may edit (101-S2, 101-S4)
      setup_minutes: venue.setup_minutes ?? 0,
      turnaround_minutes: venue.turnaround_minutes ?? 0,
      can_edit_timing: canEditVenueTiming(res.locals.role as Role),
      // SCRUM-57: whether to offer the add (and, with SCRUM-58, edit) actions; the server refuses anyone else regardless
      can_manage_catalogue: canManageVenueCatalogue(res.locals.role as Role),
      can_mark_unavailable: forStaff,
      unavailability: upcoming.map((b) => unavailabilityBlockView(b, forStaff)),
      layouts: (venue.venue_supported_layouts ?? []).map((l) => ({ name: l.room_layouts.name, max_capacity: l.max_capacity_for_layout })),
      facilities: (venue.venue_facilities ?? []).map((f) => f.facilities.name),
    });
  }));

  // SCRUM-103: what occupies a venue on one day, setup and turnaround included (103-S5).
  router.get(
    "/:id/availability",
    asyncHandler(async (req, res) => {
      const { token } = res.locals.user as SessionUser;
      const date = String(req.query.date ?? "");
      if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date) || !isRealDate(date)) {
        throw validationFailed({ date: "Enter the date as YYYY-MM-DD." });
      }

      const { data: venue } = await deps
        .forUser(token)
        .from("venues")
        .select("id, name, setup_minutes, turnaround_minutes")
        .eq("id", req.params.id)
        .maybeSingle<{ id: string; name: string; setup_minutes: number | null; turnaround_minutes: number | null }>();
      if (!venue) throw notFound("Venue not found.");

      // The Singapore day, midnight to midnight; a booking whose padding reaches into it counts.
      const from = sgtToUtc(date, "00:00");
      const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
      const periods = await occupancyFor(token).occupiedPeriods(venue.id, from, to);
      // SCRUM-105: the blocks touching that day, drawn as "Unavailable" (the block itself has no setup or turnaround)
      const blocks = (await unavailabilityFor(token).list(venue.id, false)).filter((b) => b.start.getTime() < to.getTime() && b.end.getTime() > from.getTime());

      res.set("Cache-Control", "no-store").json({
        venue: { id: venue.id, name: venue.name },
        date,
        setup_minutes: venue.setup_minutes ?? 0,
        turnaround_minutes: venue.turnaround_minutes ?? 0,
        periods: periods.map((p) => ({
          status: p.status,
          event_start: p.eventStart.toISOString(),
          event_end: p.eventEnd.toISOString(),
          occupied_start: p.occupiedStart.toISOString(),
          occupied_end: p.occupiedEnd.toISOString(),
        })),
        unavailable: blocks.map((b) => unavailabilityBlockView(b, false)),
      });
    }),
  );

  // SCRUM-101: Venue Staff set a venue's setup and turnaround times. The role is checked before the body (101-S4),
  // and the write goes through set_venue_timing, which enforces it again in the database.
  router.put(
    "/:id/timing",
    asyncHandler(async (req, res) => {
      const { token } = res.locals.user as SessionUser;
      if (!canEditVenueTiming(res.locals.role as Role)) throw forbidden("Only venue staff can change a venue's setup and turnaround times.");

      const parsed = parseVenueTimingInput(req.body);
      if (!parsed.ok) throw validationFailed(parsed.fieldErrors as Record<string, string>);

      const { data: venue } = await deps.forUser(token).from("venues").select("id").eq("id", req.params.id).maybeSingle();
      if (!venue) throw notFound("Venue not found.");

      const { setupMinutes, turnaroundMinutes } = parsed.data;
      // SCRUM-104: the save also flags the existing bookings that now clash, and says which (104-S1, 104-S6)
      const pairs = await timingFor(token).set(req.params.id as string, setupMinutes, turnaroundMinutes);
      res.json({
        setup_minutes: setupMinutes,
        turnaround_minutes: turnaroundMinutes,
        affected: pairs.map(toAffectedPairDto),
        message: bookingsAffectedMessage(pairs.length),
      });
    }),
  );

  // SCRUM-105: Venue Staff mark a venue unavailable for a period with a reason. The role comes before the body (105-S6), the same
  // shared parser as the form checks the body (105-S2, 105-S3), and mark_venue_unavailable enforces both again in the database.
  router.post(
    "/:id/unavailability",
    asyncHandler(async (req, res) => {
      const { token } = res.locals.user as SessionUser;
      if (!canMarkVenueUnavailable(res.locals.role as Role)) throw forbidden("Only venue staff can mark a venue unavailable.");

      const parsed = parseUnavailabilityInput(req.body);
      if (!parsed.ok) throw validationFailed(parsed.fieldErrors);

      const { data: venue } = await deps.forUser(token).from("venues").select("id").eq("id", req.params.id).maybeSingle();
      if (!venue) throw notFound("Venue not found.");

      const { start, end, reason, notes } = parsed.data;
      const { block, affectedBookings } = await unavailabilityFor(token).mark(req.params.id as string, {
        start,
        end,
        reason,
        ...(notes !== undefined ? { notes } : {}),
      });
      // SCRUM-106: the database has flagged the affected bookings and told their coordinators; Venue Staff see how many
      res.status(201).json({ block: unavailabilityBlockView(block, true), affectedBookings, message: bookingsFlaggedMessage(affectedBookings) });
    }),
  );

  return router;
}
