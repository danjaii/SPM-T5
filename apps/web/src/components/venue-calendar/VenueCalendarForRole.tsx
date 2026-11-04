import type { ReactNode } from "react";
import { canMarkVenueUnavailable } from "@spm-t5/shared";
import { getCurrentRole } from "@/lib/currentRoleServer";
import { VenueCalendar } from "./VenueCalendar";

// SCRUM-130/AC3: Venue Staff get Mark unavailable on the calendar; the service and the database check it again. A server component,
// so the page itself stays synchronous.
export async function VenueCalendarForRole({ heading }: { heading?: ReactNode } = {}) {
  return <VenueCalendar heading={heading} canMarkUnavailable={canMarkVenueUnavailable(await getCurrentRole())} />;
}
