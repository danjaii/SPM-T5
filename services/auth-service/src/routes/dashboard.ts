import { Router } from "express";
import type { Role } from "@spm-t5/shared";
import type { SupabaseDeps } from "../supabase";
import { requireSession, type SessionUser } from "../middlewares/session";

type Row = Record<string, unknown>;
interface Section {
  title: string;
  columns: { key: string; label: string }[];
  rows: Row[];
}

const LIMIT = 25;

const cell = (value: unknown): string | number => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
};
const date = (value: unknown) => (typeof value === "string" ? value.slice(0, 16).replace("T", " ") : "—");
const status = (value: unknown) => (typeof value === "string" ? value.replace(/_/g, " ") : "—");
// PostgREST returns an embedded row as an object (or a one-item array, depending on the relation).
const nested = (value: unknown, key: string): unknown =>
  (Array.isArray(value) ? (value[0] as Row | undefined) : (value as Row | null))?.[key];

/**
 * US3: each role only gets the data its dashboard is for. Reads use the caller's own token
 * (RLS-scoped client), not the secret key.
 */
export function dashboardRoutes(deps: SupabaseDeps) {
  const router = Router();

  router.get("/", requireSession(deps), async (_req, res) => {
    const { id, role, token, fullName, email } = res.locals.user as SessionUser;
    const db = deps.forUser(token);

    const rows = async (query: PromiseLike<{ data: unknown; error: unknown }>): Promise<Row[]> => {
      const { data, error } = await query;
      if (error) throw new Error("query failed");
      return (data ?? []) as Row[];
    };

    try {
      const sections = await sectionsFor(role, id, db, rows);
      res.set("Cache-Control", "no-store");
      res.json({ user: { fullName, email, role }, sections });
    } catch {
      res.status(500).json({ error: "We couldn't load your dashboard. Please try again." });
    }
  });

  return router;
}

type Db = ReturnType<SupabaseDeps["forUser"]>;
type Fetch = (query: PromiseLike<{ data: unknown; error: unknown }>) => Promise<Row[]>;

async function sectionsFor(role: Role, userId: string, db: Db, rows: Fetch): Promise<Section[]> {
  switch (role) {
    case "event_organiser": {
      const events = await rows(
        db.from("events").select("name, status, preferred_start_datetime, expected_attendance")
          .eq("organiser_id", userId).order("created_at", { ascending: false }).limit(LIMIT),
      );
      return [{
        title: "My event requests",
        columns: [
          { key: "name", label: "Event" }, { key: "status", label: "Status" },
          { key: "start", label: "Preferred start" }, { key: "attendance", label: "Expected attendance" },
        ],
        rows: events.map((e) => ({ name: cell(e.name), status: status(e.status), start: date(e.preferred_start_datetime), attendance: cell(e.expected_attendance) })),
      }];
    }
    case "event_coordinator": {
      const [events, bookings] = await Promise.all([
        rows(db.from("events").select("name, status, preferred_start_datetime, expected_attendance")
          .eq("assigned_coordinator_id", userId).order("preferred_start_datetime", { ascending: true }).limit(LIMIT)),
        rows(db.from("venue_bookings").select("status, event_start_datetime, event_end_datetime, event:events(name), venue:venues(name)")
          .eq("requested_by", userId).order("event_start_datetime", { ascending: true }).limit(LIMIT)),
      ]);
      return [
        {
          title: "Events I coordinate",
          columns: [
            { key: "name", label: "Event" }, { key: "status", label: "Status" },
            { key: "start", label: "Starts" }, { key: "attendance", label: "Expected attendance" },
          ],
          rows: events.map((e) => ({ name: cell(e.name), status: status(e.status), start: date(e.preferred_start_datetime), attendance: cell(e.expected_attendance) })),
        },
        {
          title: "My venue booking requests",
          columns: [
            { key: "event", label: "Event" }, { key: "venue", label: "Venue" },
            { key: "status", label: "Status" }, { key: "start", label: "From" }, { key: "end", label: "To" },
          ],
          rows: bookings.map((b) => ({ event: cell(nested(b.event, "name")), venue: cell(nested(b.venue, "name")), status: status(b.status), start: date(b.event_start_datetime), end: date(b.event_end_datetime) })),
        },
      ];
    }
    case "venue_staff": {
      const [venues, bookings] = await Promise.all([
        rows(db.from("venues").select("name, address, max_capacity, operating_hours_start, operating_hours_end, is_accessible")
          .eq("is_active", true).order("name").limit(LIMIT)),
        rows(db.from("venue_bookings").select("status, event_start_datetime, event_end_datetime, event:events(name), venue:venues(name)")
          .in("status", ["requested", "tentative"]).order("event_start_datetime", { ascending: true }).limit(LIMIT)),
      ]);
      return [
        {
          title: "Venues",
          columns: [
            { key: "name", label: "Venue" }, { key: "address", label: "Address" }, { key: "capacity", label: "Capacity" },
            { key: "hours", label: "Operating hours" }, { key: "accessible", label: "Accessible" },
          ],
          rows: venues.map((v) => ({ name: cell(v.name), address: cell(v.address), capacity: cell(v.max_capacity), hours: `${String(v.operating_hours_start ?? "—").slice(0, 5)}–${String(v.operating_hours_end ?? "—").slice(0, 5)}`, accessible: cell(v.is_accessible) })),
        },
        {
          title: "Booking requests awaiting review",
          columns: [
            { key: "event", label: "Event" }, { key: "venue", label: "Venue" },
            { key: "status", label: "Status" }, { key: "start", label: "From" }, { key: "end", label: "To" },
          ],
          rows: bookings.map((b) => ({ event: cell(nested(b.event, "name")), venue: cell(nested(b.venue, "name")), status: status(b.status), start: date(b.event_start_datetime), end: date(b.event_end_datetime) })),
        },
      ];
    }
    case "technical_support_staff": {
      const [equipment, requests] = await Promise.all([
        rows(db.from("equipment").select("name, type, total_quantity, location, operational_status").order("name").limit(LIMIT)),
        rows(db.from("technical_support_requests").select("description, status, created_at, event:events(name)")
          .order("created_at", { ascending: false }).limit(LIMIT)),
      ]);
      return [
        {
          title: "Equipment",
          columns: [
            { key: "name", label: "Item" }, { key: "type", label: "Type" }, { key: "quantity", label: "Quantity" },
            { key: "location", label: "Location" }, { key: "status", label: "Status" },
          ],
          rows: equipment.map((q) => ({ name: cell(q.name), type: cell(q.type), quantity: cell(q.total_quantity), location: cell(q.location), status: status(q.operational_status) })),
        },
        {
          title: "Technical support requests",
          columns: [
            { key: "event", label: "Event" }, { key: "description", label: "Request" },
            { key: "status", label: "Status" }, { key: "created", label: "Requested" },
          ],
          rows: requests.map((r) => ({ event: cell(nested(r.event, "name")), description: cell(r.description), status: status(r.status), created: date(r.created_at) })),
        },
      ];
    }
    case "attendee": {
      const [registrations, catalogue] = await Promise.all([
        rows(db.from("event_registrations").select("status, registered_at, event:events(name, preferred_start_datetime)")
          .eq("attendee_id", userId).order("registered_at", { ascending: false }).limit(LIMIT)),
        rows(db.from("events").select("name, description, preferred_start_datetime, registration_capacity")
          .eq("status", "confirmed").eq("registration_required", true)
          .order("preferred_start_datetime", { ascending: true }).limit(LIMIT)),
      ]);
      return [
        {
          title: "My registrations & tickets",
          columns: [
            { key: "event", label: "Event" }, { key: "start", label: "Starts" },
            { key: "status", label: "Status" }, { key: "registered", label: "Registered on" },
          ],
          rows: registrations.map((r) => ({ event: cell(nested(r.event, "name")), start: date(nested(r.event, "preferred_start_datetime")), status: status(r.status), registered: date(r.registered_at) })),
        },
        {
          title: "Events open for booking",
          columns: [
            { key: "name", label: "Event" }, { key: "description", label: "About" },
            { key: "start", label: "Starts" }, { key: "capacity", label: "Capacity" },
          ],
          rows: catalogue.map((e) => ({ name: cell(e.name), description: cell(e.description), start: date(e.preferred_start_datetime), capacity: cell(e.registration_capacity) })),
        },
      ];
    }
  }
}
