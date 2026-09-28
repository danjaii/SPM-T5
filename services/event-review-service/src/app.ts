import express from "express";
import { requireSession, type SessionOptions } from "./middlewares/session";

export function createApp(options: SessionOptions) {
  const app = express();
  app.use("/review/requests", requireSession(options));
  return app;
}
