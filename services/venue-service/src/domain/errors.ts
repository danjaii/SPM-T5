import {
  VENUE_BOOKING_MESSAGES,
  layoutTypeInUseMessage,
  type BookingAtVenue,
  type LayoutTypeUsage,
  type UnmetRequirement,
  type VenueBookingErrorCode,
} from "@spm-t5/shared";

/** DR12 error contract: 409 business-rule codes, plus the generic 401/403/404/422 cases. */
export type ServiceErrorCode =
  | VenueBookingErrorCode
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  /** SCRUM-58: a capacity cut would leave bookings over capacity; repeat with confirmImpact to save it anyway. */
  | "CONFIRM_IMPACT"
  /** SCRUM-181: a layout type that venues or event requests still use cannot be deleted. */
  | "LAYOUT_TYPE_IN_USE";

export class BookingError extends Error {
  constructor(
    readonly code: ServiceErrorCode,
    readonly httpStatus: number,
    message: string,
    readonly fieldErrors?: Record<string, string>,
    /** SCRUM-110: the unmet requirements an UNSUITABLE_VENUE refusal lists, so the form can show them. */
    readonly unmet?: UnmetRequirement[],
    /** SCRUM-58: the bookings a CONFIRM_IMPACT refusal lists, so the form can show them. */
    readonly affected?: BookingAtVenue[],
    /** SCRUM-181: the venues (named) and the number of event requests a LAYOUT_TYPE_IN_USE refusal lists. */
    readonly usedBy?: LayoutTypeUsage,
  ) {
    super(message);
    this.name = "BookingError";
  }

  /**
   * The HTTP response body. Deliberately only the code and message (plus field errors for 422):
   * a refusal must never reveal another event's name, its Coordinator or its request (36-S5, DR12).
   */
  toBody(): {
    code: ServiceErrorCode;
    error: string;
    fieldErrors?: Record<string, string>;
    unmet?: UnmetRequirement[];
    affected?: BookingAtVenue[];
    usedBy?: LayoutTypeUsage;
  } {
    if (this.usedBy) return { code: this.code, error: this.message, usedBy: this.usedBy };
    if (this.affected) return { code: this.code, error: this.message, affected: this.affected };
    if (this.unmet) return { code: this.code, error: this.message, unmet: this.unmet };
    return this.fieldErrors
      ? { code: this.code, error: this.message, fieldErrors: this.fieldErrors }
      : { code: this.code, error: this.message };
  }
}

/** A 409 business-rule refusal with the standard message for that code. */
export function bookingError(code: keyof typeof VENUE_BOOKING_MESSAGES): BookingError {
  return new BookingError(code, 409, VENUE_BOOKING_MESSAGES[code]);
}

/** SCRUM-110: 409 with the requirements that are not met; the coordinator may repeat the request with a reason. */
export const unsuitableVenue = (unmet: UnmetRequirement[]) =>
  new BookingError("UNSUITABLE_VENUE", 409, VENUE_BOOKING_MESSAGES.UNSUITABLE_VENUE, undefined, unmet);

export const unauthenticated = () => new BookingError("UNAUTHENTICATED", 401, "Not signed in.");
export const forbidden = (message = "You are not allowed to do that.") => new BookingError("FORBIDDEN", 403, message);
export const notFound = (message: string) => new BookingError("NOT_FOUND", 404, message);
export const validationFailed = (fieldErrors: Record<string, string>) =>
  new BookingError("VALIDATION_FAILED", 422, "Some fields are invalid.", fieldErrors);

/** SCRUM-58/AC4: 409 with the bookings a capacity cut would leave over capacity; the save goes through when sent again with confirmImpact. */
export const confirmImpact = (affected: BookingAtVenue[]) =>
  new BookingError(
    "CONFIRM_IMPACT",
    409,
    "These bookings expect more people than the venue would hold. Check them before saving.",
    undefined,
    undefined,
    affected,
  );

/** SCRUM-181/AC4: 409 naming the venues that use the layout type and counting the event requests that prefer it; nothing is deleted. */
export const layoutTypeInUse = (name: string, usedBy: LayoutTypeUsage) =>
  new BookingError("LAYOUT_TYPE_IN_USE", 409, layoutTypeInUseMessage(name, usedBy), undefined, undefined, undefined, usedBy);
