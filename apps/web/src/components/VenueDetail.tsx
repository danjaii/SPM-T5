import { Building2, CalendarDays, Check, Clock } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatShortSgt, type UnavailabilityBlockView } from "@spm-t5/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { VenueActions } from "./VenueActions";

export interface VenueDetails {
  id: string;
  name: string;
  address: string;
  description: string | null;
  max_capacity: number;
  operating_hours_start: string | null;
  operating_hours_end: string | null;
  is_accessible: boolean;
  accessibility_notes: string | null;
  layouts: { name: string; max_capacity: number }[];
  facilities: string[];
  /** SCRUM-101: whole minutes, 0 until Venue Staff set them. */
  setup_minutes: number;
  turnaround_minutes: number;
  /** SCRUM-101: true for Venue Staff only (101-S4). */
  can_edit_timing: boolean;
  /** SCRUM-57/58: true for Venue Staff only; they may add and edit venues. Absent from an older service. */
  can_manage_catalogue?: boolean;
  /** SCRUM-105: true for Venue Staff only (105-S6). Absent from an older service. */
  can_mark_unavailable?: boolean;
  /** SCRUM-105: the blocks that have not ended, earliest first. Notes and recordedBy are Venue Staff only. */
  unavailability?: UnavailabilityBlockView[];
}

const minutes = (n: number) => `${n} ${n === 1 ? "minute" : "minutes"}`;

/** One labelled fact: the label is the <dt>, the value the <dd> straight after it. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-5">
      <h2 className="text-base font-bold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted-foreground">{children}</p>;

// SCRUM-29 AC2: all of a venue's characteristics, as used later for suitability checks.
// SCRUM-129/AC1: setup and turnaround times sit next to the capacity. AC2/AC3: Venue Staff get the Edit venue and Mark
// unavailable buttons; every other role reads the same card with none.
export function VenueDetail({ venue }: { venue: VenueDetails }) {
  const blocks = venue.unavailability ?? [];
  const now = Date.now();
  const unavailableNow = blocks.some((b) => new Date(b.start).getTime() <= now && now < new Date(b.end).getTime());
  const hours =
    venue.operating_hours_start && venue.operating_hours_end
      ? `${venue.operating_hours_start.slice(0, 5)} – ${venue.operating_hours_end.slice(0, 5)}`
      : "Not listed";
  const accessibility = (venue.accessibility_notes ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <Card className="gap-0 py-0">
      <div className="flex h-28 items-center justify-center bg-secondary text-fg-primary" aria-hidden="true">
        <Building2 className="size-10" />
      </div>
      <CardHeader className="gap-4 px-6 pt-6 sm:grid-cols-[1fr_auto]">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{venue.name}</h1>
            {unavailableNow ? (
              <StatusBadge tone="warning" icon="timer-off" label="Venue unavailable" />
            ) : (
              <StatusBadge tone="success" label="Available" />
            )}
          </div>
          <p className="text-sm text-muted-foreground">{venue.address}</p>
          {venue.description && <p className="pt-1 text-sm text-foreground">{venue.description}</p>}
        </div>
        <VenueActions
          venueId={venue.id}
          venueName={venue.name}
          setupMinutes={venue.setup_minutes}
          turnaroundMinutes={venue.turnaround_minutes}
          canEdit={venue.can_edit_timing}
          canManage={venue.can_manage_catalogue ?? false}
          canMarkUnavailable={venue.can_mark_unavailable ?? false}
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-5 p-6">
        <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Fact label="Maximum capacity">{venue.max_capacity} people</Fact>
          <Fact label="Setup time">{minutes(venue.setup_minutes)}</Fact>
          <Fact label="Turnaround time">{minutes(venue.turnaround_minutes)}</Fact>
          <Fact label="Operating hours">{hours}</Fact>
        </dl>

        {/* SCRUM-103: what is booked on a day, with setup and turnaround shown apart from the event */}
        <Link
          href={`/venues/${venue.id}/availability`}
          className="flex w-fit items-center gap-2 text-sm font-semibold text-fg-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CalendarDays aria-hidden="true" className="size-4" />
          View availability
        </Link>

        <Section title="Capacity by layout">
          {venue.layouts.length === 0 ? (
            <Empty>No layouts listed.</Empty>
          ) : (
            <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {venue.layouts.map((l) => (
                <li key={l.name} className="rounded-lg border border-border bg-accent p-3">
                  <p className="text-xl font-bold text-foreground">{l.max_capacity}</p>
                  <p className="text-sm text-muted-foreground">{l.name}</p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Facilities">
          {venue.facilities.length === 0 ? (
            <Empty>No facilities listed.</Empty>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {venue.facilities.map((f) => (
                <li key={f}>
                  <Badge variant="info" className="h-auto py-1">{f}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Accessibility">
          {!venue.is_accessible ? (
            <Empty>Not marked as accessible</Empty>
          ) : (
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {(accessibility.length > 0 ? accessibility : ["Accessible"]).map((a) => (
                <li key={a} className="flex items-center gap-2 text-sm text-foreground">
                  <Check aria-hidden="true" className="size-4 rounded-full bg-status-success p-0.5 text-status-success-fg" />
                  {a}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* SCRUM-105: periods when the venue cannot be requested; new requests that touch one are refused (105-S4) */}
        <Section title="Unavailable periods">
          {blocks.length === 0 ? (
            <Empty>No upcoming unavailable periods.</Empty>
          ) : (
            <ul className="flex flex-col gap-2">
              {blocks.map((b) => (
                <li key={b.id} className="flex items-start gap-2 text-sm text-foreground">
                  <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="flex flex-col">
                    <span>{`${formatShortSgt(new Date(b.start))} to ${formatShortSgt(new Date(b.end))}, ${b.reasonLabel}`}</span>
                    {b.notes && <span className="text-muted-foreground">{b.notes}</span>}
                    {b.recordedBy && (
                      <span className="text-muted-foreground">{`Recorded by ${b.recordedBy} on ${formatShortSgt(new Date(b.recordedAt))}`}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </CardContent>
    </Card>
  );
}
