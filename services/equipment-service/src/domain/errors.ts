/** The refusals equipment-service sends back, each with its HTTP status. */
export type ServiceErrorCode = "FORBIDDEN" | "VALIDATION_FAILED" | "INSUFFICIENT";

export class ServiceError extends Error {
  constructor(
    readonly code: ServiceErrorCode,
    readonly httpStatus: number,
    message: string,
    readonly fieldErrors?: Record<string, string>,
    /** For INSUFFICIENT: how many were free. */
    readonly available?: number,
  ) {
    super(message);
    this.name = "ServiceError";
  }

  /** The HTTP response body: the code and message, plus a message per invalid field. */
  toBody(): { code: ServiceErrorCode; error: string; fieldErrors?: Record<string, string>; available?: number } {
    if (this.fieldErrors) return { code: this.code, error: this.message, fieldErrors: this.fieldErrors };
    if (this.available !== undefined) return { code: this.code, error: this.message, available: this.available };
    return { code: this.code, error: this.message };
  }
}

/** 403: signed in, but this role may not do it. */
export const forbidden = () => new ServiceError("FORBIDDEN", 403, "You are not allowed to do that.");

/** 422: the request was understood, but some fields are missing or invalid (one message per field). */
export const validationFailed = (fieldErrors: Record<string, string>) =>
  new ServiceError("VALIDATION_FAILED", 422, "Some fields are invalid.", fieldErrors);

/** 409: the request is fine, but fewer are free in that period than were asked for. */
export const insufficient = (available: number, requested: number) =>
  new ServiceError(
    "INSUFFICIENT",
    409,
    `Only ${available} available for that period, but you asked for ${requested}.`,
    undefined,
    available,
  );
