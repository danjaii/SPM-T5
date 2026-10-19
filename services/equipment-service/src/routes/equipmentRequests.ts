import { Router } from "express";
import { asyncHandler } from "../middlewares/errors";
import type { SessionUser } from "../middlewares/session";
import type { PortsFactory } from "../ports";
import { EquipmentRequestService } from "../services/equipmentRequestService";
import { EquipmentReviewService } from "../services/equipmentReviewService";

/**
 * SCRUM-86: an Event Coordinator requests equipment for their event. SCRUM-87: Technical Support Staff review the
 * requests. Session middleware is mounted by the caller.
 */
export function equipmentRequestRoutes(portsFor: PortsFactory) {
  const router = Router();

  /** Who is asking (AC7: the service refuses anyone but the event's assigned coordinator), and the service. */
  async function context(user: SessionUser) {
    const ports = portsFor(user.token);
    const caller = { id: user.id, role: await ports.roles.roleOf(user.id) };
    return { caller, requests: new EquipmentRequestService(ports), reviews: new EquipmentReviewService(ports) };
  }

  // AC1: the event, the items and the approved venues for the request form.
  router.get(
    "/events/:id/equipment-request-form",
    asyncHandler(async (req, res) => {
      const { caller, requests } = await context(res.locals.user as SessionUser);
      res.set("Cache-Control", "no-store").json(await requests.form(caller, String(req.params.id)));
    }),
  );

  // AC2, AC3: the event's requests, and whether the caller may add one (AC6, AC7).
  router.get(
    "/events/:id/equipment-requests",
    asyncHandler(async (req, res) => {
      const { caller, requests } = await context(res.locals.user as SessionUser);
      res.set("Cache-Control", "no-store").json(await requests.forEvent(caller, String(req.params.id)));
    }),
  );

  // AC1: save a request. 201 "created" when it is saved as Submitted.
  router.post(
    "/events/:id/equipment-requests",
    asyncHandler(async (req, res) => {
      const { caller, requests } = await context(res.locals.user as SessionUser);
      res.status(201).json(await requests.create(caller, String(req.params.id), req.body ?? {}));
    }),
  );

  // SCRUM-88/AC1: the form to change a request, starting on its current details.
  router.get(
    "/events/:id/equipment-requests/:requestId/edit-form",
    asyncHandler(async (req, res) => {
      const { caller, requests } = await context(res.locals.user as SessionUser);
      res
        .set("Cache-Control", "no-store")
        .json(await requests.editForm(caller, String(req.params.id), String(req.params.requestId)));
    }),
  );

  // SCRUM-88/AC1, AC2: save the change; the request goes back to Submitted. Answers with the request as now shown.
  router.patch(
    "/events/:id/equipment-requests/:requestId",
    asyncHandler(async (req, res) => {
      const { caller, requests } = await context(res.locals.user as SessionUser);
      res.json(await requests.update(caller, String(req.params.id), String(req.params.requestId), req.body ?? {}));
    }),
  );

  // SCRUM-87/AC1, AC2: the requests waiting for action, soonest event first. AC7: Technical Support Staff only.
  router.get(
    "/equipment-requests",
    asyncHandler(async (_req, res) => {
      const { caller, reviews } = await context(res.locals.user as SessionUser);
      res.set("Cache-Control", "no-store").json(await reviews.queue(caller));
    }),
  );

  // SCRUM-87/AC3: one request in full.
  router.get(
    "/equipment-requests/:requestId",
    asyncHandler(async (req, res) => {
      const { caller, reviews } = await context(res.locals.user as SessionUser);
      res.set("Cache-Control", "no-store").json(await reviews.detail(caller, String(req.params.requestId)));
    }),
  );

  // SCRUM-87/AC4, AC5: change its status. Answers with the updated request.
  router.patch(
    "/equipment-requests/:requestId",
    asyncHandler(async (req, res) => {
      const { caller, reviews } = await context(res.locals.user as SessionUser);
      res.json(await reviews.review(caller, String(req.params.requestId), req.body ?? {}));
    }),
  );

  return router;
}
