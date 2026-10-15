import { Router, type Response } from "express";
import {
  EVENT_FIELD_LABELS,
  EVENT_IMPORTANT_FIELDS,
  EVENT_IMPORTANT_FORM_FIELDS,
  EVENT_ORDINARY_FIELDS,
  affectedArrangements,
  eventDetailsFormValues,
  isClosedEventStatus,
  parseEventDetailsInput,
  type CurrentEventDetails,
  type EventDetailsChanges,
  type ImpactEquipmentRequest,
  type ImpactVenueBooking,
} from "@spm-t5/shared";
import { requireSession, type SessionUser } from "../middlewares/session";
import type { SupabaseDeps } from "../supabase";
import { lookUpRole } from "./events";

/** The columns the edit works on, plus who coordinates the event and its status. */
const EDITABLE_COLUMNS =
  "id, status, assigned_coordinator_id, name, description, purpose, event_category_id, preferred_start_datetime, " +
  "preferred_end_datetime, expected_attendance, preferred_room_layout_id, accessibility_requirements, venue_requirements, " +
  "equipment_requirements_notes";

type EditableEventRow = CurrentEventDetails & { id: string; status: string; assigned_coordinator_id: string | null };

type HistoryRow = {
  id: string;
  changed_at: string;
  is_important: boolean;
  changes: Record<string, { from: unknown; to: unknown }>;
  changer: { full_name: string | null } | null;
};

const HISTORY_NOT_ALLOWED = { error: "You are not allowed to view this event's history." };

type VenueBookingRow = {
  id: string;
  status: string;
  event_start_datetime: string;
  event_end_datetime: string;
  snapshot_expected_attendance: number | null;
  venue: { name: string; max_capacity: number } | null;
};

type EquipmentRequestRow = {
  id: string;
  status: string;
  quantity_requested: number;
  start_datetime: string;
  end_datetime: string;
  equipment: { name: string } | null;
};

const LOCKED = { code: "EVENT_LOCKED", error: "A completed, cancelled or rejected event can't be edited." };
const NOT_ALLOWED = { error: "You are not allowed to edit this event." };

/** update_event_details() (migration 34) refuses with these; nothing from the database reaches the caller. */
function saveFailed(res: Response, error: { code?: string; message: string }) {
  if (error.code === "42501") return res.status(403).json(NOT_ALLOWED);
  if (error.code === "CS111") {
    return res.status(409).json({ code: "STALE", error: "This event was changed while you were editing. Reload it and try again." });
  }
  if (error.code === "CS112") return res.status(409).json(LOCKED);
  // 111-S9: a category or room layout that is not in the list
  if (error.code === "23503" && error.message.includes("event_category_id")) {
    return res.status(422).json({ code: "VALIDATION_FAILED", error: "Some fields need attention.", fieldErrors: { categoryId: "Choose a category from the list." } });
  }
  if (error.code === "23503" && error.message.includes("preferred_room_layout_id")) {
    return res.status(422).json({ code: "VALIDATION_FAILED", error: "Some fields need attention.", fieldErrors: { roomLayoutId: "Choose a room layout from the list." } });
  }
  console.error("update_event_details failed:", error.message);
  return res.status(500).json({ error: "We couldn't save the event details. Please try again." });
}

/**
 * SCRUM-111 (docs/specs/edit-event-details.md): the assigned coordinator edits an event's planning information. The route
 * checks who and when and validates with the shared rules; update_event_details() (migration 34) checks again and saves the
 * event and its history row together, because coordinators may only update an event's status and coordinator directly (14).
 */
export function eventDetailsRoutes(deps: SupabaseDeps, now: () => Date) {
  const router = Router();

  /**
   * SCRUM-112: the event's venue bookings and equipment requests that an important change affects, read as the coordinator.
   * Null if they could not be read, so the change is not saved without the coordinator having seen them.
   */
  async function affectedBy(token: string, event: EditableEventRow, changes: EventDetailsChanges) {
    const db = deps.forUser(token);
    // "!venue_id": venue_bookings also links to venues through suggested_venue_id (SCRUM-40), so name the booked one
    const bookings = await db
      .from("venue_bookings")
      .select("id, status, event_start_datetime, event_end_datetime, snapshot_expected_attendance, venue:venues!venue_id(name, max_capacity)")
      .eq("event_id", event.id);
    const requests = await db
      .from("equipment_reservations")
      .select("id, status, quantity_requested, start_datetime, end_datetime, equipment:equipment(name)")
      .eq("event_id", event.id);
    if (bookings.error || requests.error) {
      console.error("reading the event's arrangements failed:", (bookings.error ?? requests.error)!.message);
      return null;
    }
    const venueBookings: ImpactVenueBooking[] = ((bookings.data ?? []) as unknown as VenueBookingRow[]).map((b) => ({
      id: b.id,
      venueName: b.venue?.name ?? "Venue",
      venueCapacity: b.venue?.max_capacity ?? 0,
      status: b.status,
      start: b.event_start_datetime,
      end: b.event_end_datetime,
      expectedAttendance: b.snapshot_expected_attendance,
    }));
    const equipmentRequests: ImpactEquipmentRequest[] = ((requests.data ?? []) as unknown as EquipmentRequestRow[]).map((r) => ({
      id: r.id,
      equipmentName: r.equipment?.name ?? "Equipment",
      quantity: r.quantity_requested,
      status: r.status,
      start: r.start_datetime,
      end: r.end_datetime,
    }));
    return affectedArrangements(changes, event, venueBookings, equipmentRequests);
  }

  /** The categories or room layouts to choose from, by name. */
  async function choices(token: string, table: "event_categories" | "room_layouts") {
    const { data } = await deps.forUser(token).from(table).select("id, name").order("name");
    return (data ?? []) as { id: string; name: string }[];
  }

  // 111-S4 (AC2): what the edit form starts with, for the assigned coordinator of an event that can still be edited
  router.get("/:id/edit-form", requireSession(deps), async (req, res) => {
    const user = res.locals.user as SessionUser;
    if ((await lookUpRole(deps, user)) !== "event_coordinator") return res.status(403).json(NOT_ALLOWED);
    const { data: event } = await deps
      .forUser(user.token)
      .from("events")
      .select(EDITABLE_COLUMNS)
      .eq("id", req.params.id)
      .maybeSingle<EditableEventRow>();
    if (!event) return res.status(404).json({ error: "Event not found." });
    if (event.assigned_coordinator_id !== user.id) return res.status(403).json(NOT_ALLOWED);
    if (isClosedEventStatus(event.status)) return res.status(409).json(LOCKED);

    const [categories, roomLayouts] = await Promise.all([choices(user.token, "event_categories"), choices(user.token, "room_layouts")]);
    return res.json({ values: eventDetailsFormValues(event), categories, roomLayouts, importantFields: EVENT_IMPORTANT_FORM_FIELDS });
  });

  // 111-S13, 111-S14 (AC4): who changed what and when, newest first, for the event's coordinator and its organiser
  router.get("/:id/change-history", requireSession(deps), async (req, res) => {
    const user = res.locals.user as SessionUser;
    const role = await lookUpRole(deps, user);
    if (role !== "event_coordinator" && role !== "event_organiser") return res.status(403).json(HISTORY_NOT_ALLOWED);

    const { data: event } = await deps
      .forUser(user.token)
      .from("events")
      .select("id, assigned_coordinator_id, organiser_id")
      .eq("id", req.params.id)
      .maybeSingle<{ id: string; assigned_coordinator_id: string | null; organiser_id: string }>();
    // another organiser's event looks exactly like one that does not exist, as on the event page (SCRUM-7/AC3)
    if (!event || (role === "event_organiser" && event.organiser_id !== user.id)) return res.status(404).json({ error: "Event not found." });
    if (role === "event_coordinator" && event.assigned_coordinator_id !== user.id) return res.status(403).json(HISTORY_NOT_ALLOWED);

    const [{ data: rows }, categories, roomLayouts] = await Promise.all([
      deps
        .forUser(user.token)
        .from("event_change_history")
        .select("id, changed_at, is_important, changes, changer:changed_by(full_name)")
        .eq("event_id", event.id)
        .order("changed_at", { ascending: false }),
      choices(user.token, "event_categories"),
      choices(user.token, "room_layouts"),
    ]);
    // a category or layout is shown by its name, not its id
    const nameOf = (field: string, value: unknown) => {
      const list = field === "event_category_id" ? categories : field === "preferred_room_layout_id" ? roomLayouts : null;
      return list && typeof value === "string" ? (list.find((c) => c.id === value)?.name ?? value) : value;
    };
    // always in the form's order, whatever order the database keeps them in
    const order: string[] = [...EVENT_ORDINARY_FIELDS, ...EVENT_IMPORTANT_FIELDS];

    return res.json(
      ((rows ?? []) as unknown as HistoryRow[]).map((row) => ({
        id: row.id,
        changedAt: row.changed_at,
        changedBy: row.changer?.full_name ?? null,
        important: row.is_important,
        changes: order
          .filter((field) => field in row.changes)
          .map((field) => ({
            field,
            label: EVENT_FIELD_LABELS[field as keyof typeof EVENT_FIELD_LABELS],
            from: nameOf(field, row.changes[field].from),
            to: nameOf(field, row.changes[field].to),
          })),
      })),
    );
  });

  router.patch("/:id", requireSession(deps), async (req, res) => {
    const user = res.locals.user as SessionUser;

    // AC7: only a coordinator, and (below) only the one the event is assigned to now
    if ((await lookUpRole(deps, user)) !== "event_coordinator") return res.status(403).json(NOT_ALLOWED);

    const { data: event } = await deps
      .forUser(user.token)
      .from("events")
      .select(EDITABLE_COLUMNS)
      .eq("id", req.params.id)
      .maybeSingle<EditableEventRow>();
    if (!event) return res.status(404).json({ error: "Event not found." });
    if (event.assigned_coordinator_id !== user.id) return res.status(403).json(NOT_ALLOWED);

    // AC6: finished events are left as they are
    if (isClosedEventStatus(event.status)) return res.status(409).json(LOCKED);

    // AC3, AC4: the shared rules (the form uses the same), and what changed
    const parsed = parseEventDetailsInput(req.body, event, now());
    if (!parsed.ok && parsed.noChanges) return res.status(409).json({ code: "NO_CHANGES", error: "Nothing was changed." });
    if (!parsed.ok) return res.status(422).json({ code: "VALIDATION_FAILED", error: "Some fields need attention.", fieldErrors: parsed.fieldErrors });

    const { changes, important } = parsed.data;

    // SCRUM-112/AC1 to AC5: an important change that affects arrangements is shown to the coordinator first, and saved
    // only when they send it again with confirmImpact: true; AC6: one that affects nothing is saved straight away
    if (important && req.body?.confirmImpact !== true) {
      const affected = await affectedBy(user.token, event, changes);
      if (!affected) return res.status(500).json({ error: "We couldn't check the event's arrangements. Please try again." });
      if (affected.length > 0) {
        return res.status(409).json({
          code: "CONFIRM_IMPACT",
          error: "This change may affect existing arrangements. Check them before saving.",
          affected,
        });
      }
    }

    const { error } = await deps
      .forUser(user.token)
      .rpc("update_event_details", { p_event_id: event.id, p_changes: changes }); // it works out "important" itself
    if (error) return saveFailed(res, error);

    return res.json({ changes, important, message: "Event details saved." });
  });

  return router;
}
