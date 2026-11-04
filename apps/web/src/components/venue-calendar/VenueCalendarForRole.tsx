import type { ReactNode } from "react";
import { canMarkVenueUnavailable, canRequestVenue, canRequestVenueBookings, isRole } from "@spm-t5/shared";
import { getAssignedEvents } from "@/lib/coordinatorDashboardServer";
import { getCurrentRole } from "@/lib/currentRoleServer";
import { VenueCalendar } from "./VenueCalendar";

// SCRUM-130/AC3: Venue Staff get Mark unavailable on the calendar. SCRUM-130 (Figma 09): an Event Coordinator gets New booking, with
// their assigned events that can still take a venue request (SCRUM-32). The services and the database check both again. A server
// component, so the page itself stays synchronous.
export async function VenueCalendarForRole({ heading }: { heading?: ReactNode } = {}) {
  const role = await getCurrentRole();
  const bookable =
    isRole(role) && canRequestVenueBookings(role)
      ? ((await getAssignedEvents()) ?? []).filter((e) => canRequestVenue(e.status)).map((e) => ({ id: e.id, name: e.name }))
      : undefined;
  return <VenueCalendar heading={heading} canMarkUnavailable={canMarkVenueUnavailable(role)} bookableEvents={bookable} />;
}
