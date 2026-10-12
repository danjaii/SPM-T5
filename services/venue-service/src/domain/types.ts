/** What a request keeps of its event as at submission (DR8, 32-S10). */
export interface BookingSnapshot {
  eventName: string;
  expectedAttendance: number | null;
  venueRequirements: string | null;
  accessibilityNeeds: string | null;
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
  /** The rejected request this one amends (SCRUM-60, SCRUM-59). */
  amendsBookingId: string | null;
  /** True when created by accepting the amended request's suggestion (SCRUM-59). */
  fromSuggestion: boolean;
  /** Venue Staff's suggested alternative on a rejection (SCRUM-40). */
  suggestion: { venueId: string; start: Date; end: Date } | null;
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
}
