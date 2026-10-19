import { Router } from "express";
import { z } from "zod";
import { parseNotificationLimit } from "@spm-t5/shared";
import { validationFailed } from "../domain/errors";
import { asyncHandler } from "../middlewares/errors";
import type { SessionUser } from "../middlewares/session";
import type { AccessReader } from "../readers/accessReader";
import type { NotificationRepository } from "../repositories/notificationRepository";
import { acknowledgeNotification, listNotifications, markNotificationRead, unreadCount } from "../services/notificationService";

const idSchema = z.string().uuid();

/** SCRUM-46: the signed-in caller's notifications. Mounted behind requireSession, so res.locals.user is set. */
export function notificationRoutes(
  repoFor: (accessToken: string) => NotificationRepository,
  accessFor: (accessToken: string) => AccessReader,
) {
  const router = Router();
  const depsFor = (token: string) => ({ repo: repoFor(token), access: accessFor(token) });

  // AC1, AC2, AC6
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const { id, token } = res.locals.user as SessionUser;
      res.json(await listNotifications(depsFor(token), id, parseNotificationLimit(req.query.limit)));
    }),
  );

  // Registered before "/:id/read" so it is never read as an id.
  router.get(
    "/unread-count",
    asyncHandler(async (_req, res) => {
      const { id, token } = res.locals.user as SessionUser;
      res.json({ unreadCount: await unreadCount(depsFor(token), id) });
    }),
  );

  // AC4
  router.post(
    "/:id/read",
    asyncHandler(async (req, res) => {
      const { id, token } = res.locals.user as SessionUser;
      const parsed = idSchema.safeParse(req.params.id);
      if (!parsed.success) throw validationFailed("The notification id is not valid.");
      res.json(await markNotificationRead(depsFor(token), id, parsed.data));
    }),
  );

  // SCRUM-20/AC4, AC5: acknowledge an on-site assignment notification
  router.post(
    "/:id/acknowledge",
    asyncHandler(async (req, res) => {
      const { id, token } = res.locals.user as SessionUser;
      const parsed = idSchema.safeParse(req.params.id);
      if (!parsed.success) throw validationFailed("The notification id is not valid.");
      res.json(await acknowledgeNotification(depsFor(token), id, parsed.data));
    }),
  );

  return router;
}
