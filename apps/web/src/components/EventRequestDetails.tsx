import Link from "next/link";
import type { ReactNode } from "react";
import { EventSection } from "@/components/event/EventSection";
import { buttonVariants } from "@/components/ui/button";
import type { EventDetailView } from "@/lib/events";
import { formatLastSaved } from "@/lib/formatLastSaved";
import { cn } from "@/lib/utils";

// SCRUM-23/AC3: what a field shows when the organiser left it blank, so it's never mistaken for real data.
export const NOT_PROVIDED = "Not provided";

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" });

function preferredSlot(start: string | null, end: string | null): string | null {
  if (!start) return null;
  return end ? `${formatDateTime(start)} – ${formatDateTime(end)}` : formatDateTime(start);
}

function Value({ children }: { children: ReactNode }) {
  return children == null || children === "" ? <span className="text-muted-foreground">{NOT_PROVIDED}</span> : <>{children}</>;
}

// SCRUM-23/AC2: everything the organiser submitted, for the coordinator to assess the request. SCRUM-127: Figma "Request
// details" card, a two-column grid with the long fields across the full width and Edit details in the header (SCRUM-111/AC6).
export function EventRequestDetails({ event }: { event: EventDetailView }) {
  const rows: [string, ReactNode, boolean?][] = [
    ["Organiser", event.organiser_name],
    ["Category", event.category_name],
    ["Purpose", event.purpose],
    ["Preferred date and time", preferredSlot(event.preferred_start_datetime, event.preferred_end_datetime)],
    ["Expected attendees", event.expected_attendance === null ? null : `${event.expected_attendance} people`],
    ["Layout preference", event.preferred_layout_name],
    ["Accessibility needs", event.accessibility_requirements],
    ["Venue requirements", event.venue_requirements],
    ["Equipment needs", event.equipment_requirements_notes],
    // SCRUM-49/AC6: the time as well as the date, so the confirmation is still there once the banner has gone
    ["Submitted", event.submitted_at && formatDateTime(event.submitted_at)],
    // SCRUM-53/AC3: a draft shows when it was last saved
    ...(event.status === "draft" ? [["Last saved", event.updated_at && formatLastSaved(event.updated_at)] as [string, ReactNode]] : []),
    // SCRUM-111/AC5: details the coordinator can edit
    ["Description", event.description, true],
  ];

  return (
    <EventSection
      id="request-details"
      title="Request details"
      action={event.canEdit && (
        <Link className={cn(buttonVariants({ variant: "ghost", size: "sm" }))} href={`/events/${event.id}/edit`}>Edit event details</Link>
      )}
    >
      <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {rows.map(([label, value, wide]) => (
          <div key={label} className={cn("flex min-w-0 flex-col gap-1", wide && "sm:col-span-2")}>
            <dt className="text-xs font-medium text-fg-primary">{label}</dt>
            <dd className="text-sm break-words text-foreground">
              <Value>{value}</Value>
            </dd>
          </div>
        ))}
      </dl>
    </EventSection>
  );
}
