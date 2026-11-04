import { Router } from "express";
import { canManageEquipmentCatalogue, parseEquipmentInput } from "@spm-t5/shared";
import { forbidden, notFound, validationFailed } from "../domain/errors";
import { asyncHandler } from "../middlewares/errors";
import type { SessionUser } from "../middlewares/session";
import type { PortsFactory } from "../ports";
import type { EquipmentCatalogueStore } from "../repositories/equipmentCatalogueStore";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * SCRUM-182 (docs/specs/equipment-catalogue-maintenance.md): Technical Support Staff add and edit equipment, and change an item's
 * operational status. Every role but Technical Support Staff is refused, even for GET (182-S5), and the role comes before the
 * body is read. The database functions enforce the role again, so RLS stays the authority and this is the friendly 403. Session
 * middleware is mounted by the caller.
 */
export function equipmentCatalogueRoutes(portsFor: PortsFactory, storeFor: (accessToken: string) => EquipmentCatalogueStore) {
  const router = Router();

  /** Refuses everyone but Technical Support Staff, and hands back the store for this caller. */
  async function guard(user: SessionUser): Promise<EquipmentCatalogueStore> {
    const role = await portsFor(user.token).roles.roleOf(user.id);
    if (!role || !canManageEquipmentCatalogue(role)) throw forbidden();
    return storeFor(user.token);
  }

  // 182-S1..S3: every item with its details, by name, never cached
  router.get(
    "/equipment-catalogue",
    asyncHandler(async (_req, res) => {
      const store = await guard(res.locals.user as SessionUser);
      res.set("Cache-Control", "no-store").json(await store.list());
    }),
  );

  // 182-S1, S4: add an item. The same shared parser as the page checks the body; a new item starts available.
  router.post(
    "/equipment-catalogue",
    asyncHandler(async (req, res) => {
      const store = await guard(res.locals.user as SessionUser);
      const parsed = parseEquipmentInput(req.body, "add");
      if (!parsed.ok) throw validationFailed(parsed.fieldErrors as Record<string, string>);
      res.status(201).json(await store.create(parsed.data));
    }),
  );

  // 182-S2, S3, S4: change an item, including its status. An unknown (or malformed) id is 404 once the role is known.
  router.put(
    "/equipment-catalogue/:id",
    asyncHandler(async (req, res) => {
      const store = await guard(res.locals.user as SessionUser);
      const id = String(req.params.id);
      if (!ID.test(id)) throw notFound("Equipment not found.");
      const parsed = parseEquipmentInput(req.body, "edit");
      if (!parsed.ok) throw validationFailed(parsed.fieldErrors as Record<string, string>);
      res.json(await store.update(id, parsed.data));
    }),
  );

  return router;
}
