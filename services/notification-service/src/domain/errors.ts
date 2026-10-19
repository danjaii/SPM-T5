export type NotificationErrorCode =
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "NOT_ACKNOWLEDGEABLE"
  | "ASSIGNMENT_CANCELLED"
  | "OUT_OF_DATE";

/** An expected refusal (401/404/409/422) with a code and message; anything else is an unexpected failure (500). */
export class NotificationError extends Error {
  constructor(
    readonly code: NotificationErrorCode,
    readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = "NotificationError";
  }

  toBody(): { code: NotificationErrorCode; error: string } {
    return { code: this.code, error: this.message };
  }
}

export const notFound = (message = "Notification not found.") => new NotificationError("NOT_FOUND", 404, message);
export const validationFailed = (message: string) => new NotificationError("VALIDATION_FAILED", 422, message);

/** SCRUM-20: 409 answers when an assignment notification cannot be acknowledged. */
export const notAcknowledgeable = () =>
  new NotificationError("NOT_ACKNOWLEDGEABLE", 409, "This notification cannot be acknowledged.");
export const assignmentCancelled = () =>
  new NotificationError("ASSIGNMENT_CANCELLED", 409, "This assignment was cancelled, so there is nothing to acknowledge.");
export const outOfDate = () =>
  new NotificationError("OUT_OF_DATE", 409, "This assignment changed since this notification. Acknowledge the newer one.");
