/** The refusals equipment-service sends back, each with its HTTP status. */
export type ServiceErrorCode =
  | "FORBIDDEN"
  | "VALIDATION_FAILED"
  | "INSUFFICIENT"
  | "NOT_FOUND"
  | "EVENT_LOCKED"
  | "NOT_WAITING"
  | "NOT_EDITABLE";

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

/** 404: there is no such event (or the caller may not see it). */
export const notFound = (message: string) => new ServiceError("NOT_FOUND", 404, message);

/** 409, SCRUM-86/AC6: the event is finished, so no equipment can be requested for it. */
export const eventLocked = (message: string) => new ServiceError("EVENT_LOCKED", 409, message);

/** 409, SCRUM-87/AC4: the request is already Arranged or Cannot Fulfil, so its status can no longer be changed. */
export const notWaiting = (message: string) => new ServiceError("NOT_WAITING", 409, message);

/** 409, SCRUM-88 (decision): Released equipment cannot be changed. */
export const notEditable = (message: string) => new ServiceError("NOT_EDITABLE", 409, message);

/** 409, SCRUM-87 (decision): too few units are free in the request's period to mark it Arranged. */
export const tooFewToArrange = (available: number, needed: number) =>
  new ServiceError(
    "INSUFFICIENT",
    409,
    `Only ${available} available for that period, but this request needs ${needed}. It has not been marked Arranged.`,
    undefined,
    available,
  );
