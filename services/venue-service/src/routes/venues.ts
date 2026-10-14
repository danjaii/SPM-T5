import { Router } from "express";
import { canEditVenueTiming, canViewVenueCatalogue, isRole, parseVenueSearchInput, parseVenueTimingInput, type Role } from "@spm-t5/shared";
import { forbidden, notFound, validationFailed } from "../domain/errors";
import type { SupabaseDeps } from "../supabase";
import { asyncHandler } from "../middlewares/errors";
import { requireSession, type SessionUser } from "../middlewares/session";
import { SupabaseVenueSearchReader, type VenueSearchReader } from "../readers/venueSearchReader";
import { SupabaseVenueTimingWriter, type VenueTimingWriter } from "../readers/venueTimingWriter";
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

export function venueRoutes(
  deps: SupabaseDeps,
  searchFor: (accessToken: string) => VenueSearchReader = (token) => new SupabaseVenueSearchReader(deps.forUser(token)),
  now: () => Date = () => new Date(),
  timingFor: (accessToken: string) => VenueTimingWriter = (token) => new SupabaseVenueTimingWriter(deps.forUser(token)),
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
  router.get("/:id", async (req, res) => {
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
      layouts: (venue.venue_supported_layouts ?? []).map((l) => ({ name: l.room_layouts.name, max_capacity: l.max_capacity_for_layout })),
      facilities: (venue.venue_facilities ?? []).map((f) => f.facilities.name),
    });
  });

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
      await timingFor(token).set(req.params.id as string, setupMinutes, turnaroundMinutes);
      res.json({ setup_minutes: setupMinutes, turnaround_minutes: turnaroundMinutes });
    }),
  );

  return router;
}
