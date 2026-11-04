import { Router } from "express";
import { canManageVenueCatalogue, parseLayoutTypeInput } from "@spm-t5/shared";
import { forbidden, notFound, validationFailed } from "../domain/errors";
import type { SupabaseDeps } from "../supabase";
import { asyncHandler } from "../middlewares/errors";
import { requireSession, type SessionUser } from "../middlewares/session";
import { SupabaseLayoutTypeStore, type LayoutTypeStore } from "../readers/layoutTypeStore";
import { SupabaseRoleReader } from "../readers/roleReader";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * SCRUM-181: Venue Staff add, rename and delete room layout types. The router has its own session check and refuses every role
 * but Venue Staff, even for GET (181-S6): the choices other roles need already come from GET /venues/search-options and
 * GET /events/request-options. The role comes before the body is read, as POST /venues does. The database functions enforce
 * the role again, so RLS stays the authority and this is the friendly 403.
 */
export function layoutTypeRoutes(
  deps: SupabaseDeps,
  storeFor: (accessToken: string) => LayoutTypeStore = (token) => new SupabaseLayoutTypeStore(deps.forUser(token)),
) {
  const router = Router();

  router.use(
    requireSession(deps),
    asyncHandler(async (_req, res, next) => {
      const { id, token } = res.locals.user as SessionUser;
      const role = await new SupabaseRoleReader(deps.forUser(token)).roleOf(id);
      if (!role || !canManageVenueCatalogue(role)) throw forbidden("Only venue staff can manage layout types.");
      next();
    }),
  );

  // 181-S1..S4: every layout type with the number of venues that support it, by name, never cached.
  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const { token } = res.locals.user as SessionUser;
      res.set("Cache-Control", "no-store").json(await storeFor(token).list());
    }),
  );

  // 181-S1, S5: add a layout type. The same shared parser as the page checks the name.
  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const { token } = res.locals.user as SessionUser;
      const parsed = parseLayoutTypeInput(req.body);
      if (!parsed.ok) throw validationFailed(parsed.fieldErrors);
      res.status(201).json(await storeFor(token).create(parsed.data.name));
    }),
  );

  // 181-S2, S5: rename a layout type. An unknown (or malformed) id is 404 once the role is known.
  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const { token } = res.locals.user as SessionUser;
      const id = req.params.id as string;
      if (!ID.test(id)) throw notFound("Layout type not found.");
      const parsed = parseLayoutTypeInput(req.body);
      if (!parsed.ok) throw validationFailed(parsed.fieldErrors);
      res.json(await storeFor(token).rename(id, parsed.data.name));
    }),
  );

  // 181-S3, S4: delete a layout type nothing uses; 409 LAYOUT_TYPE_IN_USE (naming the venues) when something does.
  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const { token } = res.locals.user as SessionUser;
      const id = req.params.id as string;
      if (!ID.test(id)) throw notFound("Layout type not found.");
      res.json(await storeFor(token).remove(id));
    }),
  );

  return router;
}
