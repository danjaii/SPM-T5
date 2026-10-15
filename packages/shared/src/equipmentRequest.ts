import { z } from "zod";
import { dbStatusToApi, type VenueBookingStatus } from "./venueBooking";

// Equipment request rules shared by equipment-service and apps/web (docs/specs/equipment-requests.md, SCRUM-86).
// A request is a row in equipment_reservations (see the spec's "Implementation decisions"). Every rule that rests on
// one of the spec's open questions is one constant below, so it can be changed in one place.

// ---------------------------------------------------------------------------
// Which events, venues and items a request can be made for.
// ---------------------------------------------------------------------------

/**
 * SCRUM-86/AC6 (decision): no requests for a finished event. The spec names Completed and Cancelled; Rejected is
 * added because it is final too. equipment_request_event_open() in migration 25 must match this list (an
 * integration test checks).
 */
export const EQUIPMENT_REQUEST_LOCKED_EVENT_STATUSES = ["completed", "cancelled", "rejected"] as const;

export function canRequestEquipment(eventStatus: string): boolean {
  return !(EQUIPMENT_REQUEST_LOCKED_EVENT_STATUSES as readonly string[]).includes(eventStatus);
}

/** Open question 1 (assumed yes): every request names a venue. */
export const EQUIPMENT_REQUEST_VENUE_REQUIRED = true;

/**
 * Open question 1 (decision): only the event's approved venue bookings can be picked, meaning the bookings the venue
 * pages show as APPROVED (dbStatusToApi in venueBooking.ts), so legacy `tentative` and `confirmed` rows count too.
 * is_requestable_booking() in migration 25 must match this list (an integration test checks).
 */
export const EQUIPMENT_REQUEST_VENUE_BOOKING_API_STATUS: VenueBookingStatus = "APPROVED";

export function isRequestableVenueBooking(bookingStatus: string): boolean {
  return dbStatusToApi(bookingStatus) === EQUIPMENT_REQUEST_VENUE_BOOKING_API_STATUS;
}

/** Decision: the coordinator picks a catalogue item; any item except a retired one can be asked for. */
export const REQUESTABLE_EQUIPMENT_STATUSES = ["available", "damaged", "under_maintenance"] as const;

export function isRequestableEquipment(operationalStatus: string): boolean {
  return (REQUESTABLE_EQUIPMENT_STATUSES as readonly string[]).includes(operationalStatus);
}

/** Open question 2: items are listed under their catalogue type ("Audio: Wireless Microphone Set"). */
export function equipmentOptionLabel(item: { type: string | null; name: string }): string {
  return item.type ? `${item.type}: ${item.name}` : item.name;
}

// ---------------------------------------------------------------------------
// Statuses: the four the spec names, mapped from equipment_reservation_status.
// ---------------------------------------------------------------------------

// SCRUM-102/AC7 adds RELEASED: the equipment of a venue booking the coordinator cancelled, freed for other events.
export const EQUIPMENT_REQUEST_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "ARRANGED", "CANNOT_FULFIL", "RELEASED"] as const;
export type EquipmentRequestStatus = (typeof EQUIPMENT_REQUEST_STATUSES)[number];

export const EQUIPMENT_REQUEST_STATUS_LABELS: Record<EquipmentRequestStatus, string> = {
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under Review",
  ARRANGED: "Arranged",
  CANNOT_FULFIL: "Cannot Fulfil",
  RELEASED: "Released",
};

/** Decision: how each DB status reads. `under_review` arrives with SCRUM-87. */
const DB_TO_REQUEST_STATUS: Record<string, EquipmentRequestStatus> = {
  requested: "SUBMITTED",
  under_review: "UNDER_REVIEW",
  approved: "ARRANGED",
  reserved: "ARRANGED",
  rejected: "CANNOT_FULFIL",
  cancelled: "RELEASED", // SCRUM-102 (102-S31): cancel_venue_booking() (migration 30) releases a venue booking's equipment
};

/** The status a row shows as, or undefined for a status this code does not know (that row is not shown). */
export function equipmentRequestStatusOf(dbStatus: string): EquipmentRequestStatus | undefined {
  return DB_TO_REQUEST_STATUS[dbStatus];
}

// ---------------------------------------------------------------------------
// SCRUM-86/AC4, AC5: input validation, identical in the form (apps/web) and the API (equipment-service).
// ---------------------------------------------------------------------------

export const EQUIPMENT_REQUEST_MESSAGES = {
  equipmentMissing: "Choose the equipment.",
  quantityMissing: "Enter the quantity.",
  /** AC5: the spec's exact wording (the SCRUM-18/19 forms keep their own). */
  quantityInvalid: "Quantity must be a whole number of 1 or more",
  venueMissing: "Choose the venue.",
  /** AC6 */
  eventLocked: "Equipment can't be requested for a completed, cancelled or rejected event.",
} as const;

/** A form value as trimmed text; a field left out counts as blank. */
const text = z.preprocess((value) => (value == null ? "" : String(value).trim()), z.string());

const inputShape = (venueRequired: boolean) =>
  z.object({
    equipmentId: text.pipe(z.string().min(1, EQUIPMENT_REQUEST_MESSAGES.equipmentMissing)),
    // Digits only (no "-", "." or "e"), at least 1, and at most nine digits so it fits the database's int.
    quantity: text.pipe(
      z
        .string()
        .min(1, EQUIPMENT_REQUEST_MESSAGES.quantityMissing)
        .regex(/^\d{1,9}$/, EQUIPMENT_REQUEST_MESSAGES.quantityInvalid)
        .refine((q) => Number(q) >= 1, EQUIPMENT_REQUEST_MESSAGES.quantityInvalid),
    ),
    venueBookingId: text.pipe(venueRequired ? z.string().min(1, EQUIPMENT_REQUEST_MESSAGES.venueMissing) : z.string()),
    notes: text,
  });

export interface EquipmentRequestInput {
  equipmentId: string;
  quantity: number;
  venueBookingId: string | null;
  /** Optional: blank is saved as none. */
  notes: string | null;
}

export type ParsedEquipmentRequestInput =
  | { ok: true; data: EquipmentRequestInput }
  | { ok: false; fieldErrors: Record<string, string> };

/**
 * Validates a request body. Every invalid field gets one message, so the form can highlight them all (AC4).
 * `venueRequired` defaults to the open-question-1 rule; it is a parameter so both answers can be tested.
 */
export function parseEquipmentRequestInput(
  body: unknown,
  { venueRequired = EQUIPMENT_REQUEST_VENUE_REQUIRED }: { venueRequired?: boolean } = {},
): ParsedEquipmentRequestInput {
  const parsed = inputShape(venueRequired).safeParse(body ?? {});
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0])] ??= issue.message;
    }
    return { ok: false, fieldErrors };
  }
  const { equipmentId, quantity, venueBookingId, notes } = parsed.data;
  return {
    ok: true,
    data: { equipmentId, quantity: Number(quantity), venueBookingId: venueBookingId || null, notes: notes || null },
  };
}

// ---------------------------------------------------------------------------
// SCRUM-87: Technical Support Staff review requests.
// ---------------------------------------------------------------------------

/** AC1, AC2, AC4: the statuses waiting for action, which the queue lists and staff can change. */
export const EQUIPMENT_REQUEST_WAITING_STATUSES = ["SUBMITTED", "UNDER_REVIEW"] as const satisfies readonly EquipmentRequestStatus[];

export function isWaitingEquipmentRequest(status: EquipmentRequestStatus): boolean {
  return (EQUIPMENT_REQUEST_WAITING_STATUSES as readonly string[]).includes(status);
}

/** AC4: what staff can change a waiting request to. */
export const EQUIPMENT_REQUEST_REVIEW_STATUSES = ["UNDER_REVIEW", "ARRANGED", "CANNOT_FULFIL"] as const satisfies readonly EquipmentRequestStatus[];
export type EquipmentRequestReviewStatus = (typeof EQUIPMENT_REQUEST_REVIEW_STATUSES)[number];

/** The DB status each review choice saves. review_equipment_request() in migration 32 accepts exactly these. */
export const EQUIPMENT_REQUEST_REVIEW_DB_STATUS: Record<EquipmentRequestReviewStatus, string> = {
  UNDER_REVIEW: "under_review",
  ARRANGED: "approved",
  CANNOT_FULFIL: "rejected",
};

/** AC5: the longest reason accepted, so it stays readable on the event page. */
export const EQUIPMENT_REQUEST_REASON_MAX_LENGTH = 500;

export const EQUIPMENT_REQUEST_REVIEW_MESSAGES = {
  statusMissing: "Choose the new status.",
  /** AC5 */
  reasonMissing: "Give a reason why this request cannot be fulfilled.",
  reasonTooLong: `Keep the reason to ${EQUIPMENT_REQUEST_REASON_MAX_LENGTH} characters or fewer.`,
  /** AC2: the spec's exact wording. */
  queueEmpty: "No requests waiting for action",
  /** AC4: the request was already Arranged or Cannot Fulfil (for example, someone else saved first). */
  notWaiting: "This request is no longer waiting for action.",
  /** Decision: a finished event's requests are left as they are. */
  eventLocked: "Requests for a completed, cancelled or rejected event can't be changed.",
} as const;

const reviewShape = z
  .object({
    status: text.pipe(
      z.enum(EQUIPMENT_REQUEST_REVIEW_STATUSES, { errorMap: () => ({ message: EQUIPMENT_REQUEST_REVIEW_MESSAGES.statusMissing }) }),
    ),
    reason: text.pipe(z.string().max(EQUIPMENT_REQUEST_REASON_MAX_LENGTH, EQUIPMENT_REQUEST_REVIEW_MESSAGES.reasonTooLong)),
  })
  .superRefine((value, ctx) => {
    if (value.status === "CANNOT_FULFIL" && !value.reason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: EQUIPMENT_REQUEST_REVIEW_MESSAGES.reasonMissing });
    }
  });

export interface EquipmentRequestReviewInput {
  status: EquipmentRequestReviewStatus;
  /** Only kept for Cannot Fulfil; null otherwise. */
  reason: string | null;
}

export type ParsedEquipmentRequestReviewInput =
  | { ok: true; data: EquipmentRequestReviewInput }
  | { ok: false; fieldErrors: Record<string, string> };

/** AC4, AC5: validates a status change, identically in the form (apps/web) and the API (equipment-service). */
export function parseEquipmentRequestReviewInput(body: unknown): ParsedEquipmentRequestReviewInput {
  const parsed = reviewShape.safeParse(body ?? {});
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0])] ??= issue.message;
    }
    return { ok: false, fieldErrors };
  }
  const { status, reason } = parsed.data;
  return { ok: true, data: { status, reason: status === "CANNOT_FULFIL" ? reason : null } };
}

// ---------------------------------------------------------------------------
// SCRUM-87/AC6: whether the event's equipment is ready.
// ---------------------------------------------------------------------------

/** Open question 3 (assumed yes): equipment is ready only when every request is Arranged. */
export const EQUIPMENT_READY_STATUSES = ["ARRANGED"] as const satisfies readonly EquipmentRequestStatus[];

export type EquipmentReadiness = "COMPLETE" | "INCOMPLETE";

export const EQUIPMENT_READINESS_LABELS: Record<EquipmentReadiness, string> = {
  COMPLETE: "Complete",
  INCOMPLETE: "Incomplete",
};

/**
 * AC6: Complete when every request is ready, Incomplete otherwise; null for an event with no requests. Released
 * equipment (SCRUM-102) is no longer needed, so it does not count, as cancelled requests did not before.
 */
export function equipmentReadiness(all: readonly EquipmentRequestStatus[]): EquipmentReadiness | null {
  const statuses = all.filter((s) => s !== "RELEASED");
  if (statuses.length === 0) return null;
  const ready = EQUIPMENT_READY_STATUSES as readonly string[];
  return statuses.every((s) => ready.includes(s)) ? "COMPLETE" : "INCOMPLETE";
}
