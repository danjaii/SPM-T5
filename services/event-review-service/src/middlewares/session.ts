import type { RequestHandler } from "express";

export interface SessionOptions {
  url: string;
  publishableKey: string;
  fetch?: typeof fetch;
  webOrigin?: string;
}

/** ER-01/AC4: authenticate the caller; request permissions belong in database RLS. */
export function requireSession(options: SessionOptions): RequestHandler {
  return async (req, res, next) => {
    const cookie = req.headers.cookie?.split(";")
      .map((part) => part.trim()).find((part) => part.startsWith("cs_session="));
    let token: string | undefined;
    try {
      token = cookie ? decodeURIComponent(cookie.slice("cs_session=".length)) : undefined;
    } catch {
      // A malformed cookie is not an authenticated session.
    }
    if (!token) {
      res.status(401).json({ error: "Please sign in to view event requests." });
      return;
    }

    try {
      const response = await (options.fetch ?? fetch)(`${options.url.replace(/\/$/, "")}/auth/v1/user`, {
        headers: { apikey: options.publishableKey, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status >= 500) throw new Error("Authentication unavailable");
      if (!response.ok) {
        res.status(401).json({ error: "Please sign in to view event requests." });
        return;
      }
      const user = await response.json() as { id?: string };
      if (typeof user.id !== "string" || !user.id) {
        res.status(401).json({ error: "Please sign in to view event requests." });
        return;
      }
      res.locals.token = token;
      res.locals.userId = user.id;
    } catch {
      res.status(503).json({ error: "Could not load event requests. Please try again." });
      return;
    }
    next();
  };
}
