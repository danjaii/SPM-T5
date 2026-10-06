import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatEventDateTime } from "@/lib/formatEventDateTime";
import type { UpcomingEvent } from "@/lib/getUpcomingEvents";

// SCRUM-71/AC7: the label for each availability event-service can send ("open" has none)
const LABELS: Record<UpcomingEvent["availability"], string | null> = {
  cancelled: "Cancelled",
  full: "Event Full",
  closed: "Registration Closed",
  open: null,
};

// SCRUM-71/AC10: how the attendee's own active registration reads on the card
const REGISTRATIONS: Record<NonNullable<UpcomingEvent["my_registration"]>, string> = {
  confirmed: "Confirmed",
  pending: "Pending",
};

// SCRUM-71: the attendee's List of events, one card per upcoming event
export function UpcomingEventList({ events }: { events: UpcomingEvent[] }) {
  // SCRUM-71/AC11: an empty list gets a friendly message, not an empty space
  if (events.length === 0) {
    return <p className="empty">No upcoming events</p>;
  }

  return (
    <div className="event-cards">
      {events.map((event) => (
        // SCRUM-71/AC1: each event is its own card, headed by its name
        <article className="event-card" key={event.id}>
          <h3>{event.name}</h3>
          {LABELS[event.availability] && <Badge variant="secondary">{LABELS[event.availability]}</Badge>}
          {/* SCRUM-71/AC4: "Sat, 12 Dec 2026, 7:00 PM – 9:00 PM" */}
          <p className="event-card__when">
            <time dateTime={event.start_at}>{formatEventDateTime(event.start_at, event.end_at)}</time>
          </p>
          {/* SCRUM-71/AC3: the location is the venue's name and its address (none until a booking is agreed) */}
          <p className="event-card__location">
            {event.venue.name ? `${event.venue.name}, ${event.venue.address}` : "Venue to be confirmed"}
          </p>
          {/* SCRUM-71/AC8: Register leads to the event's registration form (built by the registration story) */}
          {/* SCRUM-71/AC9: only on open events; cancelled, full and closed ones have no button (their label says why) */}
          {/* SCRUM-71/AC10: an active registration shows its status instead of the button */}
          {event.my_registration ? (
            <p className="event-card__registration">Your registration: {REGISTRATIONS[event.my_registration]}</p>
          ) : (
            event.availability === "open" && (
              <Link className="btn" href={`/events/${event.id}/register`}>Register</Link>
            )
          )}
        </article>
      ))}
    </div>
  );
}
