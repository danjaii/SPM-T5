import Link from "next/link";
import { CalendarDays, TriangleAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { slotsText } from "@/lib/availabilityLabels";
import { ATTENDEE_STATUS_DISPLAY, openForRegistration, splitRegistrations } from "@/lib/attendeeDashboard";
import type { MyRegistration } from "@/lib/eventRegistration";
import type { UpcomingEvent } from "@/lib/getUpcomingEvents";
import { formatEventDateTime } from "@/lib/formatEventDateTime";

const Unavailable = ({ what }: { what: string }) => (
  <p className="flex items-center gap-2 p-5 text-base font-medium text-status-warning-fg">
    <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />
    {what} could not be loaded.
  </p>
);

function RegistrationRow({ r }: { r: MyRegistration }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden="true">
        <CalendarDays className="size-5" />
      </span>
      <span className="min-w-0 flex-1 basis-56 space-y-0.5">
        <Link className="block text-base font-semibold underline-offset-4 hover:underline" href={`/dashboard/attendee/${r.event.id}`}>{r.event.name}</Link>
        <span className="block text-sm text-muted-foreground">
          {formatEventDateTime(r.event.start_at, r.event.end_at)} · {r.event.venue.name ?? "Venue to be confirmed"}
        </span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-3">
        <StatusBadge {...ATTENDEE_STATUS_DISPLAY[r.status]} />
        <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/dashboard/attendee/${r.event.id}`} aria-label={`View ${r.event.name}`}>View</Link>
      </span>
    </li>
  );
}

/**
 * SCRUM-161 (Figma 20): the attendee's registrations, upcoming first (soonest event at the top), the withdrawn or declined
 * ones below, and the events still open for registration. A source that failed (undefined) says so, never "none".
 */
export function AttendeeDashboardOverview({ registrations, events }: { registrations?: MyRegistration[]; events?: UpcomingEvent[] }) {
  const { upcoming, closed } = registrations ? splitRegistrations(registrations) : { upcoming: [], closed: [] };
  const open = events ? openForRegistration(events) : undefined;

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
      <section aria-labelledby="my-registrations" className="overflow-hidden rounded-xl border border-border bg-card lg:col-span-2">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 id="my-registrations" className="font-heading text-xl font-bold">My registrations</h2>
          {registrations && <StatusBadge tone="neutral" label={String(registrations.length)} />}
        </div>

        {!registrations && <Unavailable what="Your registrations" />}

        {/* AC3: nothing registered yet: say so and point at the List of events */}
        {registrations?.length === 0 && (
          <div className="space-y-3 p-5">
            <p className="text-base font-medium">You have not registered for any events yet.</p>
            <Link className={buttonVariants()} href="/dashboard/attendee/browse">Browse events</Link>
          </div>
        )}

        {upcoming.length > 0 && (
          <>
            <h3 className="border-b border-border bg-muted px-5 py-2 text-sm font-semibold">Upcoming</h3>
            <ul className="divide-y divide-border">{upcoming.map((r) => <RegistrationRow key={r.id} r={r} />)}</ul>
          </>
        )}
        {closed.length > 0 && (
          <>
            <h3 className="border-y border-border bg-muted px-5 py-2 text-sm font-semibold">Withdrawn or declined</h3>
            <ul className="divide-y divide-border">{closed.map((r) => <RegistrationRow key={r.id} r={r} />)}</ul>
          </>
        )}
      </section>

      <section aria-labelledby="open-for-registration" className="overflow-hidden rounded-xl border border-border bg-card">
        <h2 id="open-for-registration" className="border-b border-border px-5 py-4 font-heading text-xl font-bold">Open for registration</h2>
        {!open && <Unavailable what="Open events" />}
        {open?.length === 0 && <p className="p-5 text-sm text-muted-foreground">No events are open for registration right now.</p>}
        {!!open?.length && (
          <ul className="divide-y divide-border">
            {open.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <span className="min-w-0 space-y-0.5">
                  <Link className="block text-sm font-semibold underline-offset-4 hover:underline" href={`/events/${e.id}/register`}>{e.name}</Link>
                  <span className="block text-xs text-muted-foreground">{slotsText(e.available_slots)}</span>
                </span>
                {e.availability === "full" ? <StatusBadge tone="info" icon="hourglass" label="Waitlist" /> : <StatusBadge tone="success" label="Open" />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
