import type { OccupiedPeriod, UnmetRequirement, VenueBookingFlagKind, VenueTiming } from "@spm-t5/shared";

/** What a request keeps of its event as at submission (DR8, 32-S10). */
export interface BookingSnapshot {
  eventName: string;
  expectedAttendance: number | null;
  venueRequirements: string | null;
  accessibilityNeeds: string | null;
}

/** SCRUM-110: the suitability check as it was at submission, kept with the request. */
export interface BookingSuitability {
  result: "suitable" | "not_suitable";
  /** The requirements that were not met. */
  unmet: UnmetRequirement[];
  /** Why the coordinator went ahead; set exactly when `result` is "not_suitable". */
  overrideReason: string | null;
}

/** A venue booking request, as held in venue_bookings. `status` is the DB enum value (see shared). */
export interface BookingRecord {
  id: string;
  eventId: string;
  venueId: string;
  /** UTC instants; the API shows them as Singapore date + time. */
  start: Date;
  end: Date;
  status: string;
  snapshot: BookingSnapshot;
  requestedBy: string | null;
  createdAt: Date;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  /** The rejection reason (review_notes). */
  reviewNotes: string | null;
  withdrawnBy: string | null;
  withdrawnAt: Date | null;
  /** SCRUM-102: who cancelled it, when and why (102-S12). */
  cancelledBy: string | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  /** The rejected request this one amends (SCRUM-60, SCRUM-59). */
  amendsBookingId: string | null;
  /** True when created by accepting the amended request's suggestion (SCRUM-59). */
  fromSuggestion: boolean;
  /** Venue Staff's suggested alternative on a rejection (SCRUM-40). */
  suggestion: { venueId: string; start: Date; end: Date } | null;
  /** SCRUM-110: null for requests made before the check existed. */
  suitability: "suitable" | "not_suitable" | null;
  suitabilityUnmet: UnmetRequirement[] | null;
  suitabilityOverrideReason: string | null;
  /** SCRUM-113: the event's changes that sent it back for review ({ field: { from, to } }), and when; null otherwise. */
  sentBackChanges: unknown;
  sentBackAt: Date | null;
  /** SCRUM-107: the approved replacement that took over a `replaced` booking, and when (migration 46); null otherwise. */
  replacedByBookingId: string | null;
  replacedAt: Date | null;
}

/** SCRUM-102/AC1: a venue booking's new period and its own numbers. Its venue never changes. */
export interface BookingChange {
  start: Date;
  end: Date;
  expectedAttendance: number | null;
  venueRequirements: string | null;
  /** SCRUM-110: the result made afresh for the changed numbers; replaces the stored one. */
  suitability?: BookingSuitability;
}

/** Venue Staff's decision on a pending request. Only a rejection carries a reason and a suggestion. */
export type Decision =
  | { outcome: "approved" }
  | {
      outcome: "rejected";
      reason?: string;
      suggestion?: { venueId: string; start: Date; end: Date };
    };

/** What the caller supplies to create a request. Status is always PENDING ("requested"). */
export interface NewBooking {
  eventId: string;
  venueId: string;
  start: Date;
  end: Date;
  requestedBy: string;
  snapshot: BookingSnapshot;
  amendsBookingId?: string | null;
  fromSuggestion?: boolean;
  /** SCRUM-110. submit() always sets it. */
  suitability?: BookingSuitability;
}

/**
 * SCRUM-105: an unavailability block in the way of a requested slot. Its own period (no setup or turnaround), the reason and the
 * venue's name, nothing about who recorded it. The refusal message uses the period only; the reason is not given away (105-S4).
 */
export interface UnavailabilityConflict {
  start: Date;
  end: Date;
  reason: string;
  venueName: string;
}

/** A holding booking that blocks a requested slot (SCRUM-103): its occupied period, plus what a refusal needs to describe it. */
export interface SlotConflict extends OccupiedPeriod {
  venueName: string;
  /** The venue's current times, so the message knows whether to mention setup and turnaround. */
  timing: VenueTiming;
}

/** SCRUM-104: one open flag on a venue booking (migration 36). Holds the other booking's period, never an event name. */
export interface FlagRecord {
  id: string;
  bookingId: string;
  kind: VenueBookingFlagKind;
  /** The other booking of a buffer conflict; null for a flag about a maintenance block (SCRUM-106). */
  otherBookingId: string | null;
  otherStart: Date | null;
  otherEnd: Date | null;
  /** SCRUM-106: the block that raised a `venue_unavailable` flag, and its reason; null for a buffer conflict. */
  unavailabilityId?: string | null;
  unavailabilityReason?: string | null;
  createdAt: Date;
}

/** SCRUM-107: a flag with its outcome, for the booking's history (107-S3). */
export interface FlagHistoryRecord extends FlagRecord {
  resolvedAt: Date | null;
  /** `no_longer_conflicts`, `booking_closed` or `replaced`; null while open. */
  resolvedReason: string | null;
}
