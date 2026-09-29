import express from "express";
import { errorHandler } from "./middlewares/errors";
import type { SupabaseDeps } from "./supabase";

// Exported separately from listen() so tests can mount the app without opening a port.
// `_deps` is unused until the routes that need Supabase are mounted (SCRUM-32); server.ts and tests already pass it.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function createApp(_deps: SupabaseDeps) {
  const app = express();
  app.use(express.json());

  // The web app (a different origin in dev) calls this service directly from the browser, with cookies.
  // Same approach as event-service's app.ts, plus POST for submit/withdraw/amend.
  app.use((req, res, next) => {
    const allowed = process.env.WEB_ORIGIN ?? "http://localhost:3000";
    if (req.headers.origin === allowed) {
      res.set({
        "Access-Control-Allow-Origin": allowed,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        Vary: "Origin",
      });
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  // Routes are mounted here as each story lands (SCRUM-32 onwards).

  app.use(errorHandler);
  return app;
}
