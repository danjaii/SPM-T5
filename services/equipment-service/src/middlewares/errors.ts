import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ServiceError } from "../domain/errors";

/** Express 4 does not catch rejected promises, so wrap async route handlers with this. */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

/**
 * A ServiceError (e.g. 422 with a message per field) is sent back as it is. Anything else is unexpected:
 * log it here, but tell the caller nothing about it.
 */
// Express recognises an error handler by its four parameters, so `_next` must stay even though unused.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ServiceError) return res.status(err.httpStatus).json(err.toBody());
  console.error("equipment-service unexpected error:", err);
  return res.status(500).json({ error: "Something went wrong." });
}
