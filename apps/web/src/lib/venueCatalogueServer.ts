import { canManageVenueCatalogue } from "@spm-t5/shared";
import { getShellData } from "./shellServer";

// Server-only: reads the signed-in user through the app shell's helper, which never redirects.

/** SCRUM-57/AC3: whether to offer the add-a-venue action. The service and the database refuse everyone else regardless. */
export async function canAddVenue(): Promise<boolean> {
  const shell = await getShellData();
  return shell !== null && canManageVenueCatalogue(shell.user.role);
}
