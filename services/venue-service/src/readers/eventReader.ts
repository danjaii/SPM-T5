/** What booking logic needs to know about an event (DR16). */
export interface EventInfo {
  id: string;
  name: string;
  /** The event_status DB value, e.g. "approved". */
  status: string;
  assignedCoordinatorId: string | null;
  expectedAttendance: number | null;
  /** The preferred room layout name: `events` has no venue-requirements column (see spec, Implementation decisions). */
  venueRequirements: string | null;
  accessibilityNeeds: string | null;
  /** The event's preferred slot, UTC instants. Null until the organiser sets it. */
  proposedStart: Date | null;
  proposedEnd: Date | null;
}

/** Booking logic reads event data only through this interface, so tests can plug in a fake (DR16). */
export interface EventReader {
  /** Null when the event does not exist or the caller cannot see it. */
  getById(eventId: string): Promise<EventInfo | null>;
  /** Ids of the events assigned to this coordinator (SCRUM-33). */
  listIdsAssignedTo(userId: string): Promise<string[]>;
}
