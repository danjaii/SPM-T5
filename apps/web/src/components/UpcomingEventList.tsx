import { CalendarDays, MapPin, Users } from "lucide-react";
import Link from "next/link";
import { RegistrationStatusBadge } from "@/components/RegistrationStatusBadge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { AVAILABILITY_LABELS as LABELS, AVAILABILITY_TONES, slotsText } from "@/lib/availabilityLabels";
import { formatEventDateTime } from "@/lib/formatEventDateTime";
import type { UpcomingEvent } from "@/lib/getUpcomingEvents";

// SCRUM-71: the attendee's List of events, one card per upcoming event
export function UpcomingEventList({ events }: { events: UpcomingEvent[] }) {
  // SCRUM-71/AC11: an empty list gets a friendly message, not an empty space
  if (events.length === 0) {
    return <p className="rounded-xl border border-dashed border-border-strong p-8 text-center text-muted-foreground">No upcoming events</p>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {events.map((event) => (
        // SCRUM-71/AC1: each event is its own card, headed by its name
        <article key={event.id}>
        {/* SCRUM-139: the whole card opens the event's details; the title link stretches over it, and Register sits above that */}
        <Card className="relative h-full transition-shadow hover:ring-2 hover:ring-ring/40 focus-within:ring-2 focus-within:ring-ring">
          <CardContent className="flex h-full flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-heading text-lg font-bold text-foreground">
                <Link className="outline-none after:absolute after:inset-0 after:content-['']" href={`/dashboard/attendee/${event.id}`}>
                  {event.name}
                </Link>
              </h3>
              {LABELS[event.availability] && <StatusBadge label={LABELS[event.availability]!} tone={AVAILABILITY_TONES[event.availability]} />}
            </div>
            {/* SCRUM-71/AC4: "Sat, 12 Dec 2026, 7:00 PM – 9:00 PM" */}
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <CalendarDays aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <time dateTime={event.start_at}>{formatEventDateTime(event.start_at, event.end_at)}</time>
            </p>
            {/* SCRUM-71/AC3: the location is the venue's name and its address (none until a booking is agreed) */}
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {event.venue.name ? `${event.venue.name}, ${event.venue.address}` : "Venue to be confirmed"}
            </p>
            {/* SCRUM-9/AC2: the available slots */}
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <Users aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {slotsText(event.available_slots)}
            </p>
            {/* SCRUM-71/AC8: Register leads to the event's registration form */}
            {/* SCRUM-71/AC9: only on open events; cancelled, full and closed ones have no button (their label says why) */}
            {/* SCRUM-71/AC10: an active registration shows its status instead of the button */}
            <div className="mt-auto flex items-center justify-end gap-2 pt-1">
              {event.my_registration ? (
                <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  Your registration:
                  <RegistrationStatusBadge status={event.my_registration} />
                </p>
              ) : (
                event.availability === "open" && (
                  <Link className={`${buttonVariants({ size: "sm" })} relative z-10`} href={`/events/${event.id}/register`}>
                    Register
                  </Link>
                )
              )}
            </div>
          </CardContent>
        </Card>
        </article>
      ))}
    </div>
  );
}
