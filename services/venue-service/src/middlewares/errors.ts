import type { NextFunction, Request, RequestHandler, Response } from "express";
import { BookingError } from "../domain/errors";

/** Express 4 does not catch rejected promises, so wrap async route handlers with this. */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

/**
 * Renders BookingErrors with their status and a code + message body (DR12). Anything else is an
 * unexpected failure: log it here, but tell the caller nothing about it, since database errors
 * can name other events' data (36-S5).
 */
// Express recognises an error handler by its four parameters, so `_next` must stay even though unused.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof BookingError) return res.status(err.httpStatus).json(err.toBody());
  console.error("venue-service unexpected error:", err);
  return res.status(500).json({ error: "Something went wrong." });
}
