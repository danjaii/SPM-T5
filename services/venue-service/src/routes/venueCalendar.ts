import { Router } from "express";
import { CALENDAR_TIME_ZONE, parseCalendarRange, type CalendarRange } from "@spm-t5/shared";
import { asyncHandler } from "../middlewares/errors";
import { requireSession, type SessionUser } from "../middlewares/session";
import { SupabaseVenueCalendarReader, type VenueCalendarReader } from "../readers/venueCalendarReader";
import { buildCalendar } from "../services/venueCalendarService";
import type { SupabaseDeps } from "../supabase";

/** SCRUM-84: GET /venue-calendar, the status of every venue across a date range (docs/specs/SCRUM-84-venue-availability-calendar.md). */
export function venueCalendarRoutes(
  deps: SupabaseDeps,
  now: () => Date = () => new Date(),
  calendarFor: (accessToken: string) => VenueCalendarReader = (token) => new SupabaseVenueCalendarReader(deps.forUser(token)),
) {
  const router = Router();

  router.get(
    "/",
    requireSession(deps),
    asyncHandler(async (req, res) => {
      const { token } = res.locals.user as SessionUser;
      const parsed = parseCalendarRange(req.query, now());
      const range = (parsed as { data: CalendarRange }).data;
      const reader = calendarFor(token);
      const [venues, entries] = await Promise.all([reader.venueList(), reader.entries(range.start, range.end)]);

      // AC7: always the latest; never cached.
      res.set("Cache-Control", "no-store").json({
        range: { from: range.from, to: range.to, start: range.start.toISOString(), end: range.end.toISOString(), time_zone: CALENDAR_TIME_ZONE },
        venues: buildCalendar(venues, entries, range),
      });
    }),
  );

  return router;
}
