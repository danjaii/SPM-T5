import type { NextFunction, Request, Response } from "express";

/**
 * The web app (a different origin) calls this service directly, sending the login cookie.
 * Credentials are on, so only the one configured web origin is allowed, never a wildcard.
 * Preflight (OPTIONS) is answered here, before requireSession would reject it for having no cookie.
 */
export function cors() {
  return (req: Request, res: Response, next: NextFunction) => {
    const allowed = process.env.WEB_ORIGIN ?? "http://localhost:3000";
    res.vary("Origin");
    if (req.headers.origin === allowed) {
      res.set({
        "Access-Control-Allow-Origin": allowed,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,OPTIONS",
      });
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  };
}
