import { CalendarDays, MapPin, Tag, UserRound, Users, Building2, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { RegistrationStatusBadge } from "@/components/RegistrationStatusBadge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { AVAILABILITY_LABELS, AVAILABILITY_TONES, slotsText } from "@/lib/availabilityLabels";
import { formatEventDateTime } from "@/lib/formatEventDateTime";
import type { UpcomingEvent } from "@/lib/getUpcomingEvents";

/** One labelled fact: the label sits directly above its value, so the pair reads as one unit (proximity). */
function Fact({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="space-y-0.5">
        <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
        <dd className="text-sm text-foreground">{children}</dd>
      </div>
    </div>
  );
}

// SCRUM-139: what an attendee sees after clicking an event on Browse events. Facts are grouped by what they answer
// (when and where / how many places / who is behind it), and the one action sits apart in its own footer.
export function EventDetails({ event }: { event: UpcomingEvent }) {
  const availability = AVAILABILITY_LABELS[event.availability];

  return (
    <article className="space-y-4">
      <Card>
        <CardContent className="space-y-6">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="font-heading text-2xl font-bold text-foreground">{event.name}</h2>
            {availability && <StatusBadge label={availability} tone={AVAILABILITY_TONES[event.availability]} />}
          </header>

          <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            <Fact icon={CalendarDays} label="When">
              <time dateTime={event.start_at}>{formatEventDateTime(event.start_at, event.end_at)}</time>
            </Fact>
            <Fact icon={MapPin} label="Where">
              {event.venue.name ? `${event.venue.name}, ${event.venue.address}` : "Venue to be confirmed"}
            </Fact>
            <Fact icon={Users} label="Places">{slotsText(event.available_slots)}</Fact>
            {event.category && <Fact icon={Tag} label="Category">{event.category}</Fact>}
            {event.organisation && <Fact icon={Building2} label="Organised by">{event.organisation}</Fact>}
            {event.coordinator && <Fact icon={UserRound} label="Event coordinator">{event.coordinator}</Fact>}
          </dl>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            {event.my_registration ? (
              <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                Your registration:
                <RegistrationStatusBadge status={event.my_registration} />
              </p>
            ) : event.availability === "open" ? (
              <p className="text-sm text-muted-foreground">Places are still open for this event.</p>
            ) : (
              <p className="text-sm text-muted-foreground">Registration is not available for this event.</p>
            )}
            {!event.my_registration && event.availability === "open" ? (
              <Link className={buttonVariants()} href={`/events/${event.id}/register`}>Register</Link>
            ) : (
              <Link className={buttonVariants({ variant: "outline" })} href="/registrations">View my registrations</Link>
            )}
          </footer>
        </CardContent>
      </Card>
    </article>
  );
}
