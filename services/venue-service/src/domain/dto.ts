import { dbStatusToApi, flagLabel, utcToSgt, type FlagDto, type VenueBookingStatus } from "@spm-t5/shared";
import type { BookingRecord, FlagRecord } from "./types";

/**
 * SCRUM-104: an open flag as the API shows it. The coordinator's version carries the other booking's period and no event
 * name (36-S5); Venue Staff pass `otherEventName` to get it too (the name is joined at read time, never stored).
 */
export function toFlagDto(f: FlagRecord, staff?: { otherEventName: string | null }): FlagDto {
  return {
    id: f.id,
    kind: f.kind,
    label: flagLabel(f.kind) ?? f.kind,
    createdAt: f.createdAt.toISOString(),
    otherPeriod:
      f.otherStart && f.otherEnd
        ? { date: utcToSgt(f.otherStart).date, startTime: utcToSgt(f.otherStart).time, endTime: utcToSgt(f.otherEnd).time }
        : null,
    ...(staff ? { otherEventName: staff.otherEventName } : {}),
  };
}

/** A venue booking request as the API shows it: Singapore date and times, API status (DR3, DR4). */
export interface BookingDto {
  id: string;
  eventId: string;
  venueId: string;
  status: VenueBookingStatus | undefined;
  date: string;
  startTime: string;
  endTime: string;
  eventName: string;
  expectedAttendance: number | null;
  venueRequirements: string | null;
  accessibilityNeeds: string | null;
  submittedBy: string | null;
  submittedAt: string;
  /** SCRUM-110: the check as it was when the request was made; null for older requests. */
  suitability: "suitable" | "not_suitable" | null;
}

export function toBookingDto(b: BookingRecord): BookingDto {
  const start = utcToSgt(b.start);
  return {
    id: b.id,
    eventId: b.eventId,
    venueId: b.venueId,
    status: dbStatusToApi(b.status),
    date: start.date,
    startTime: start.time,
    endTime: utcToSgt(b.end).time,
    eventName: b.snapshot.eventName,
    expectedAttendance: b.snapshot.expectedAttendance,
    venueRequirements: b.snapshot.venueRequirements,
    accessibilityNeeds: b.snapshot.accessibilityNeeds,
    submittedBy: b.requestedBy,
    submittedAt: b.createdAt.toISOString(),
    suitability: b.suitability,
  };
}

/** A booking just requested (SCRUM-32, 60, 59), with SCRUM-98's capacity warning. */
export interface SubmittedBookingDto extends BookingDto {
  exceedsCapacity: boolean;
}

export function toSubmittedBookingDto(s: { booking: BookingRecord; exceedsCapacity: boolean }): SubmittedBookingDto {
  return { ...toBookingDto(s.booking), exceedsCapacity: s.exceedsCapacity };
}

/** A venue booking the coordinator cancelled (SCRUM-102/AC2): who, when and why. */
export interface CancelledBookingDto extends BookingDto {
  cancelledBy: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
}

export function toCancelledBookingDto(b: BookingRecord): CancelledBookingDto {
  return {
    ...toBookingDto(b),
    cancelledBy: b.cancelledBy,
    cancelledAt: b.cancelledAt ? b.cancelledAt.toISOString() : null,
    cancellationReason: b.cancellationReason,
  };
}

/** The outcome of a Venue Staff decision (SCRUM-38, SCRUM-39): the request plus who decided, when and why. */
export interface DecisionDto extends BookingDto {
  decidedBy: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
}

export function toDecisionDto(b: BookingRecord): DecisionDto {
  return {
    ...toBookingDto(b),
    decidedBy: b.reviewedBy,
    decidedAt: b.reviewedAt ? b.reviewedAt.toISOString() : null,
    rejectionReason: b.status === "rejected" ? b.reviewNotes : null,
  };
}

/** A row in the Coordinator's list (SCRUM-33). */
export interface BookingListItem {
  id: string;
  eventId: string;
  eventName: string;
  venueId: string;
  venueName: string;
  date: string;
  startTime: string;
  endTime: string;
  status: VenueBookingStatus | undefined;
  /** Only for APPROVED and REJECTED (33-S1). */
  decidedAt: string | null;
  submittedAt: string;
  /** SCRUM-104: the open flags on this booking (buffer conflicts); empty when none. */
  flags: FlagDto[];
}

export function toBookingListItem(b: BookingRecord, venueName: string, flags: FlagDto[] = []): BookingListItem {
  const start = utcToSgt(b.start);
  const status = dbStatusToApi(b.status);
  const decided = (status === "APPROVED" || status === "REJECTED") && b.reviewedAt;
  return {
    id: b.id,
    eventId: b.eventId,
    eventName: b.snapshot.eventName,
    venueId: b.venueId,
    venueName,
    date: start.date,
    startTime: start.time,
    endTime: utcToSgt(b.end).time,
    status,
    decidedAt: decided ? b.reviewedAt!.toISOString() : null,
    submittedAt: b.createdAt.toISOString(),
    flags,
  };
}

/** One step of an amendment chain, shown with its own outcome (33-S5). */
export interface ChainItem extends BookingListItem {
  rejectionReason: string | null;
}

/** One booking in the list of an event's bookings (SCRUM-98/AC5), with its own numbers and the capacity warning. */
export interface EventBookingItem extends ChainItem {
  /** SCRUM-102: only for a CANCELLED one; null for every other status. */
  cancellationReason: string | null;
  expectedAttendance: number | null;
  venueRequirements: string | null;
  exceedsCapacity: boolean;
}

export interface BookingDetail extends BookingListItem {
  expectedAttendance: number | null;
  venueRequirements: string | null;
  accessibilityNeeds: string | null;
  submittedBy: string | null;
  rejectionReason: string | null;
  suggestion: { venueId: string; venueName: string; date: string; startTime: string; endTime: string } | null;
  amendsRequestId: string | null;
  /** The amendment chain in order, root first, including this request. */
  chain: ChainItem[];
}

export const rejectionReasonOf = (b: BookingRecord) => (b.status === "rejected" ? b.reviewNotes : null);
