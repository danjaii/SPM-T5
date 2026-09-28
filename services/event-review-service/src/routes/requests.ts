import { Router } from "express";
import type { SubmittedEventRequest } from "@spm-t5/shared";
import type { SessionOptions } from "../middlewares/session";

export function requestRoutes(options: SessionOptions) {
  const router = Router();
  router.get("/:id", async (req, res) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
      res.status(400).json({ error: "Invalid request ID." });
      return;
    }
    try {
      const response = await (options.fetch ?? fetch)(`${options.url.replace(/\/$/, "")}/rest/v1/rpc/review_submitted_requests`, {
        method: "POST",
        headers: {
          apikey: options.publishableKey,
          Authorization: `Bearer ${res.locals.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ request_id: req.params.id }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error("Request details unavailable");
      const rows = await response.json() as SubmittedEventRequest[];
      const detail = rows.find((row) => row.id === req.params.id);
      if (!detail) {
        res.status(404).json({ error: "Request not found or access denied." });
        return;
      }
      res.json(detail);
    } catch {
      res.status(503).json({ error: "Could not load event requests. Please try again." });
    }
  });
  return router;
}
