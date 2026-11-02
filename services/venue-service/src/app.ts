import express from "express";
import { errorHandler } from "./middlewares/errors";
import { requireSession } from "./middlewares/session";
import type { BookingRepository } from "./repositories/bookingRepository";
import type { VenueTimingWriter } from "./readers/venueTimingWriter";
import { SupabaseVenueSearchReader, type VenueSearchReader } from "./readers/venueSearchReader";
import type { VenueCalendarReader } from "./readers/venueCalendarReader";
import type { VenueCatalogueWriter } from "./readers/venueCatalogueWriter";
import type { VenueEditReader } from "./readers/venueEditReader";
import type { VenueUnavailabilityStore } from "./readers/venueUnavailabilityStore";
import { supabasePorts, type PortsFactory } from "./ports";
import { bookingQueueRoutes } from "./routes/bookingQueue";
import { suitabilityRoutes } from "./routes/suitability";
import { venueBookingRoutes } from "./routes/venueBookings";
import { venueCalendarRoutes } from "./routes/venueCalendar";
import { venueRoutes } from "./routes/venues";
import type { SupabaseDeps } from "./supabase";
import { healthCheck } from "./index";

export interface AppOptions {
  /** The clock, injected so tests can decide what "in the past" means (32-S5). */
  now?: () => Date;
  /** Where data comes from; tests pass fakes. Defaults to Supabase queries as the caller. */
  ports?: PortsFactory;
  /** Where the venue search (SCRUM-65) reads from; tests pass a fake. Defaults to Supabase as the caller. */
  venueSearch?: (accessToken: string) => VenueSearchReader;
  /** Where the venue setup and turnaround times are saved (SCRUM-101); tests pass a fake. Defaults to the set_venue_timing function as the caller. */
  venueTiming?: (accessToken: string) => VenueTimingWriter;
  /** Where the venue availability view (SCRUM-103) reads occupied periods from; tests pass a fake. Defaults to venue_occupied_periods as the caller. */
  venueAvailability?: (accessToken: string) => Pick<BookingRepository, "occupiedPeriods">;
  /** Where unavailability blocks are read and saved (SCRUM-105); tests pass a fake. Defaults to the table and mark_venue_unavailable as the caller. */
  venueUnavailability?: (accessToken: string) => VenueUnavailabilityStore;
  /** Where a new venue is saved (SCRUM-57); tests pass a fake. Defaults to the create_venue function as the caller. */
  venueCatalogue?: (accessToken: string) => VenueCatalogueWriter;
  /** What the venue edit reads (SCRUM-58): the form's values and the bookings a capacity cut is checked against; tests pass a fake. */
  venueEdit?: (accessToken: string) => VenueEditReader;
  /** Where the venue availability calendar (SCRUM-84) reads venues, bookings and blocks from; tests pass a fake. */
  venueCalendar?: (accessToken: string) => VenueCalendarReader;
}

// Exported separately from listen() so tests can mount the app without opening a port.
export function createApp(deps: SupabaseDeps, options: AppOptions = {}) {
  const now = options.now ?? (() => new Date());
  const portsFor = options.ports ?? supabasePorts(deps);
  const searchFor = options.venueSearch ?? ((token: string) => new SupabaseVenueSearchReader(deps.forUser(token)));
  const app = express();
  app.use(express.json());

  // The web app (a different origin in dev) calls this service directly from the browser, with cookies.
  // Same approach as event-service's app.ts, plus POST for submit/withdraw/amend, PATCH for change (SCRUM-102) and PUT for venue times (SCRUM-101).
  app.use((req, res, next) => {
    const allowed = process.env.WEB_ORIGIN ?? "http://localhost:3000";
    if (req.headers.origin === allowed) {
      res.set({
        "Access-Control-Allow-Origin": allowed,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,OPTIONS",
        Vary: "Origin",
      });
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  // SCRUM-94: liveness check for docker compose and CI; before the session check, so no login needed
  app.get("/health", (_req, res) => res.json(healthCheck()));

  // SCRUM-29: the read-only venue catalogue, GET /venues and /venues/:id (coordinators and venue staff).
  app.use("/venues", venueRoutes(deps, options.venueSearch, now, options.venueTiming, options.venueAvailability, options.venueUnavailability, options.venueCatalogue, options.venueEdit));

  // SCRUM-84: the venue availability calendar. Outside the /venues gate (which keeps out Technical Support Staff).
  app.use("/venue-calendar", venueCalendarRoutes(deps, now, options.venueCalendar));

  // Everything below needs a signed-in caller (DR2: 401). Routes are added as each story lands.
  app.use(requireSession(deps), venueBookingRoutes(portsFor, now, searchFor), bookingQueueRoutes(portsFor), suitabilityRoutes(portsFor));

  app.use(errorHandler);
  return app;
}
