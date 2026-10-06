import type { NextFunction, Request, Response } from "express";
import type { SupabaseDeps } from "../supabase";

/** The login cookie auth-service sets. The browser sends it to every localhost service. */
// this file checks the login cookie to see who is asking 
export const SESSION_COOKIE = "cs_session";

export interface SessionUser {
  id: string;
  token: string;
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/** Authentication only (401): works out who is calling and puts them on res.locals.user. */
export function requireSession({ anon }: SupabaseDeps) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) return res.status(401).json({ code: "UNAUTHENTICATED", error: "Not signed in." });

    const { data } = await anon.auth.getUser(token);
    if (!data.user) return res.status(401).json({ code: "UNAUTHENTICATED", error: "Not signed in." });

    const user: SessionUser = { id: data.user.id, token };
    res.locals.user = user;
    next();
  };
}
