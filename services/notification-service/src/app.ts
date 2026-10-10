import express from "express";

// Exported separately from listen() (see server.ts) so tests can mount it without binding a port.
export function createApp() {
  const app = express();
  app.get("/health", (_req, res) => res.json({ status: "ok", service: "notification-service" }));
  return app;
}
