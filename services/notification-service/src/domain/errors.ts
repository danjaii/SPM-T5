export type NotificationErrorCode = "UNAUTHENTICATED" | "NOT_FOUND" | "VALIDATION_FAILED";

/** An expected refusal (401/404/422) with a code and message; anything else is an unexpected failure (500). */
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
