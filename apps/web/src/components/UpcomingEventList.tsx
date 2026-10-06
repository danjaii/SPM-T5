import type { UpcomingEvent } from "@/lib/getUpcomingEvents";

// SCRUM-71: the attendee's List of events, one card per upcoming event
export function UpcomingEventList({ events }: { events: UpcomingEvent[] }) {
  return (
    <div className="event-cards">
      {events.map((event) => (
        // SCRUM-71/AC1: each event is its own card, headed by its name
        <article className="event-card" key={event.id}>
          <h3>{event.name}</h3>
        </article>
      ))}
    </div>
  );
}
