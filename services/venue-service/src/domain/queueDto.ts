import { dbStatusToApi, utcToSgt, type UnmetRequirement, type VenueBookingStatus } from "@spm-t5/shared";
import { rejectionReasonOf } from "./dto";
import type { BookingRecord } from "./types";

/** A pending request in the Venue Staff queue (SCRUM-37): the event details as copied at submission (DR8). */
export interface QueueItem {
  id: string;
  /** The event the request is for (SCRUM-109: the suitability check on the request needs it). */
  eventId: string;
  venueId: string;
  venueName: string;
  date: string;
  startTime: string;
  endTime: string;
  eventName: string;
  expectedAttendance: number | null;
  venueRequirements: string | null;
  accessibilityNeeds: string | null;
  /** The requesting Coordinator's name; null if their account is gone. */
  requestedByName: string | null;
  submittedAt: string;
  /** The rejected request this one amends (37-S4). */
  amendsRequestId: string | null;
  /** SCRUM-110: the check as it was at submission; null for requests made before it existed. */
  suitability: "suitable" | "not_suitable" | null;
  suitabilityUnmet: UnmetRequirement[];
  /** Why the coordinator requested a venue that does not suit the event. */
  suitabilityOverrideReason: string | null;
}

/** One request opened from the queue or by its address: a queue item plus its status and outcome (37-S6). */
export interface QueueDetail extends QueueItem {
  status: VenueBookingStatus | undefined;
  decidedByName: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
  /** Reserved for SCRUM-40 (suggest an alternative); always null until then. */
  suggestion: null;
}

export function toQueueItem(b: BookingRecord, venueName: string, requestedByName: string | null): QueueItem {
  return {
    id: b.id,
    eventId: b.eventId,
    venueId: b.venueId,
    venueName,
    date: utcToSgt(b.start).date,
    startTime: utcToSgt(b.start).time,
    endTime: utcToSgt(b.end).time,
    eventName: b.snapshot.eventName,
    expectedAttendance: b.snapshot.expectedAttendance,
    venueRequirements: b.snapshot.venueRequirements,
    accessibilityNeeds: b.snapshot.accessibilityNeeds,
    requestedByName,
    submittedAt: b.createdAt.toISOString(),
    amendsRequestId: b.amendsBookingId,
    suitability: b.suitability,
    suitabilityUnmet: b.suitabilityUnmet ?? [],
    suitabilityOverrideReason: b.suitabilityOverrideReason,
  };
}

export function toQueueDetail(b: BookingRecord, venueName: string, names: Map<string, string>): QueueDetail {
  const status = dbStatusToApi(b.status);
  const decided = status === "APPROVED" || status === "REJECTED";
  return {
    ...toQueueItem(b, venueName, (b.requestedBy && names.get(b.requestedBy)) || null),
    status,
    decidedByName: decided && b.reviewedBy ? (names.get(b.reviewedBy) ?? null) : null,
    decidedAt: decided && b.reviewedAt ? b.reviewedAt.toISOString() : null,
    rejectionReason: rejectionReasonOf(b),
    suggestion: null,
  };
}
