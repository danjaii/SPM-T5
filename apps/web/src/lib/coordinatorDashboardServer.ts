import { cookies } from "next/headers";
import { SERVER_EVENT_URL, SESSION_COOKIE } from "./api";
import { returnedReason, type DashboardEvent } from "./coordinatorDashboard";
import { getEventEquipmentRequests } from "./equipmentRequestsServer";
import { getEventSafetyDecisions } from "./getEvent";
import { getEventVenueBookings, getVenueBookings } from "./venueBookingsServer";
import type { VenueBookingListItem } from "./venueBookings";

// Server-only: what the Event Coordinator dashboard (SCRUM-160) reads. Each source stands alone: one that fails is
// undefined, so the page can say "Unavailable" for that part and still show the rest.

export interface ReturnedEvent {
  id: string;
  name: string;
  reason: string;
}

export interface CoordinatorDashboardData {
  events?: DashboardEvent[];
  bookings?: VenueBookingListItem[];
  /** Events back in Planning with the reason; undefined when the events themselves could not be loaded. */
  returned?: ReturnedEvent[];
}

/** SCRUM-42/AC4: the coordinator's assigned events (id, name, status). */
async function getAssignedEvents(): Promise<DashboardEvent[] | undefined> {
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token) return undefined;
    const res = await fetch(`${SERVER_EVENT_URL}/events/my-events`, {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
      cache: "no-store",
    });
    return res.ok ? ((await res.json()) as DashboardEvent[]) : undefined;
  } catch {
    return undefined;
  }
}

/** AC3: for each event in Planning, the safety decisions and sent-back arrangements that explain why it is there. */
async function returnedEvents(events: DashboardEvent[]): Promise<ReturnedEvent[]> {
  const planning = events.filter((e) => e.status === "planning");
  const found = await Promise.all(
    planning.map(async (e) => {
      const [safetyDecisions, venueBookings, equipment] = await Promise.all([
        getEventSafetyDecisions(e.id),
        getEventVenueBookings(e.id),
        getEventEquipmentRequests(e.id),
      ]);
      const reason = returnedReason({
        safetyDecisions,
        venueBookingsSentBack: venueBookings?.filter((b) => b.sentBackForReview).length ?? 0,
        equipmentRequestsSentBack: equipment?.requests.filter((r) => r.sentBackForReview).length ?? 0,
      });
      return reason ? { id: e.id, name: e.name, reason } : null;
    }),
  );
  return found.filter((r): r is ReturnedEvent => r !== null);
}

export async function getCoordinatorDashboard(): Promise<CoordinatorDashboardData> {
  const [events, venueBookings] = await Promise.all([getAssignedEvents(), getVenueBookings()]);
  return {
    events,
    bookings: "bookings" in venueBookings ? venueBookings.bookings : undefined,
    returned: events && (await returnedEvents(events)),
  };
}
