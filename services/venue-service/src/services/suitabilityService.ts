import {
  canViewVenueCatalogue,
  checkSuitability,
  parseVenueBookingInput,
  type SuitabilityReport,
} from "@spm-t5/shared";
import { forbidden, notFound, validationFailed } from "../domain/errors";
import type { EventReader } from "../readers/eventReader";
import type { VenueDetailsReader } from "../readers/venueDetailsReader";
import type { Caller } from "./bookingService";
import type { AvailabilityLookup } from "./availabilityLookup";

export interface SuitabilityDeps {
  events: EventReader;
  venueDetails: VenueDetailsReader;
  availability: AvailabilityLookup;
}

export interface SuitabilityResponse extends SuitabilityReport {
  venue: { id: string; name: string };
  event: { id: string; name: string };
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** SCRUM-109: runs the shared suitability check for one venue against one event. */
export class SuitabilityService {
  constructor(private readonly deps: SuitabilityDeps) {}

  /**
   * Allowed for coordinators and venue staff only (Scenario 7), checked first so nothing else is revealed. The query
   * is `venueId`, `eventId` and, optionally, `date` + `startTime` + `endTime`, `attendance` and `venueRequirements`, which replace what the
   * event has (the request form checks what is typed). `skipAvailability=true` leaves availability unchecked: a pending
   * request holds its own slot, so Venue Staff reviewing it would otherwise always see a clash with itself.
   */
  async check(caller: Caller, query: Record<string, unknown>): Promise<SuitabilityResponse> {
    if (!caller.role || !canViewVenueCatalogue(caller.role)) throw forbidden();

    const venueId = text(query.venueId);
    const eventId = text(query.eventId);
    const fieldErrors: Record<string, string> = {};
    if (!venueId) fieldErrors.venueId = "Choose a venue.";
    if (!eventId) fieldErrors.eventId = "Choose an event.";

    // A period override needs all three of date and times. The check may be asked about a past slot, so the
    // "not in the past" rule of booking is switched off by passing the epoch as "now".
    const hasPeriod = ["date", "startTime", "endTime"].some((k) => text(query[k]) !== "");
    let override: { start: Date; end: Date } | undefined;
    if (hasPeriod) {
      const parsed = parseVenueBookingInput(
        { venueId: venueId || "-", date: text(query.date), startTime: text(query.startTime), endTime: text(query.endTime) },
        new Date(0),
      );
      if (parsed.ok) override = { start: parsed.data.start, end: parsed.data.end };
      else Object.assign(fieldErrors, parsed.fieldErrors);
    }

    const attendanceText = text(query.attendance);
    if (attendanceText !== "" && (!/^\d+$/.test(attendanceText) || Number(attendanceText) < 1)) {
      fieldErrors.attendance = "Enter a whole number of at least 1.";
    }
    if (Object.keys(fieldErrors).length > 0) throw validationFailed(fieldErrors);

    const event = await this.deps.events.getById(eventId);
    if (!event) throw notFound("Event not found.");
    // A coordinator checks venues for their own events only (the same rule as requesting a venue).
    if (caller.role === "event_coordinator" && event.assignedCoordinatorId !== caller.id) throw forbidden();

    const venue = await this.deps.venueDetails.getById(venueId);
    if (!venue) throw notFound("Venue not found.");

    const start = override?.start ?? event.proposedStart;
    const end = override?.end ?? event.proposedEnd;
    const period = start && end ? { start, end } : null;
    const checkAvailability = period !== null && text(query.skipAvailability) !== "true";
    const conflict = checkAvailability && period ? await this.deps.availability(venue.id, period.start, period.end) : null;

    const report = checkSuitability(
      venue,
      {
        attendance: attendanceText !== "" ? Number(attendanceText) : event.expectedAttendance,
        // 110-S6: a booking's own layout (SCRUM-98) replaces the event's
        layoutName: text(query.venueRequirements) || event.venueRequirements,
        accessibilityNeeds: event.accessibilityNeeds,
        start: period?.start ?? null,
        end: period?.end ?? null,
      },
      checkAvailability ? { conflict } : null,
    );
    return { venue: { id: venue.id, name: venue.name }, event: { id: event.id, name: event.name }, ...report };
  }
}
