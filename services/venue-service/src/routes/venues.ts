import { Router } from "express";
import { canViewVenueCatalogue, isRole } from "@spm-t5/shared";
import type { SupabaseDeps } from "../supabase";
import { requireSession, type SessionUser } from "../middlewares/session";

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
}

export function venueRoutes(deps: SupabaseDeps) {
  const router = Router();

  // SCRUM-29 AC3 + AC4: every venue request must come from a signed-in coordinator or venue staff member
  router.use(requireSession(deps), async (_req, res, next) => {
    const { id, token } = res.locals.user as SessionUser;
    const { data: profile } = await deps.forUser(token).from("users").select("role").eq("id", id).maybeSingle();
    if (!isRole(profile?.role) || !canViewVenueCatalogue(profile.role)) {
      return res.status(403).json({ error: "You are not allowed to view the venue catalogue." });
    }
    next();
  });

  // SCRUM-29 AC1: list every venue with its name, location (address) and maximum capacity
  router.get("/", async (_req, res) => {
    const { token } = res.locals.user as SessionUser;

    const { data } = await deps.forUser(token).from("venues").select("id, name, address, max_capacity").order("name");

    res.json((data ?? []).map((v) => ({ id: v.id, name: v.name, address: v.address, max_capacity: v.max_capacity })));
  });

  // SCRUM-29 AC2: one venue with all its characteristics, fetched together with its layouts and facilities
  router.get("/:id", async (req, res) => {
    const { token } = res.locals.user as SessionUser;

    const { data: venue } = await deps
      .forUser(token)
      .from("venues")
      .select(
        "id, name, address, description, max_capacity, operating_hours_start, operating_hours_end, is_accessible, accessibility_notes, " +
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
      layouts: (venue.venue_supported_layouts ?? []).map((l) => ({ name: l.room_layouts.name, max_capacity: l.max_capacity_for_layout })),
      facilities: (venue.venue_facilities ?? []).map((f) => f.facilities.name),
    });
  });

  return router;
}
