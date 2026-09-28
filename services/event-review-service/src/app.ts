import express from "express";
import { requireSession, type SessionOptions } from "./middlewares/session";
import { requestRoutes } from "./routes/requests";

export function createApp(options: SessionOptions) {
  const app = express();
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.vary("Origin");
    const origin = options.webOrigin ?? "http://localhost:3000";
    if (req.headers.origin === origin) {
      res.set({
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
    }
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });
  app.use("/review/requests", requireSession(options));
  app.use("/review/requests", requestRoutes(options));
  return app;
}
