import type { NextFunction, Request, Response } from "express";
import { isRole, type Role } from "@spm-t5/shared";
import type { SupabaseDeps } from "../supabase";

export const SESSION_COOKIE = "cs_session";

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  token: string;
}

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function sessionCookieOptions(maxAgeSeconds?: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(maxAgeSeconds ? { maxAge: maxAgeSeconds * 1000 } : {}),
  };
}

/** Authentication only: identifies the caller from the session cookie and puts them on res.locals.user. */
export function requireSession({ anon, forUser }: SupabaseDeps) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) return res.status(401).json({ error: "Not signed in." });

    const { data, error } = await anon.auth.getUser(token);
    if (error || !data.user) {
      res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
      return res.status(401).json({ error: "Session expired. Please sign in again." });
    }

    const { data: profile } = await forUser(token)
      .from("users")
      .select("full_name, role, is_active")
      .eq("id", data.user.id)
      .maybeSingle();
    if (!profile || !profile.is_active || !isRole(profile.role)) {
      return res.status(401).json({ error: "Not signed in." });
    }

    const user: SessionUser = {
      id: data.user.id,
      email: data.user.email ?? "",
      fullName: profile.full_name,
      role: profile.role,
      token,
    };
    res.locals.user = user;
    next();
  };
}
