import { Router } from "express";
import { asyncHandler } from "../middlewares/errors";
import type { SessionUser } from "../middlewares/session";
import type { PortsFactory } from "../ports";
import { EquipmentRequestService } from "../services/equipmentRequestService";

/** SCRUM-86: an Event Coordinator requests equipment for their event. Session middleware is mounted by the caller. */
export function equipmentRequestRoutes(portsFor: PortsFactory) {
  const router = Router();

  /** Who is asking (AC7: the service refuses anyone but the event's assigned coordinator), and the service. */
  async function context(user: SessionUser) {
    const ports = portsFor(user.token);
    const caller = { id: user.id, role: await ports.roles.roleOf(user.id) };
    return { caller, requests: new EquipmentRequestService(ports) };
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

  return router;
}
