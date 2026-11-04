import { RegistrationDecision } from "@/components/RegistrationDecision";
import { RegistrationStatusBadge } from "@/components/RegistrationStatusBadge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { EventRegistration } from "@/lib/eventRegistration";

/** SCRUM-74/AC10: a list longer than this scrolls. */
const SCROLL_AFTER_ROWS = 15;

// SCRUM-74/AC5: the registration's date and time
const formatRegistered = (iso: string) =>
  new Date(iso).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" });

// SCRUM-83/AC15: an event's registrations, for its organiser and assigned coordinator: the details each attendee
// submitted on the form, and the registration's status. SCRUM-139/AC4, AC7: a Table with a StatusBadge for each status.
// SCRUM-169/AC3: given `eventId` and `canDecide` (the organiser, on /registrations-overview), Pending rows can be confirmed or declined.
export function EventRegistrationList({
  registrations,
  eventId,
  canDecide = false,
}: {
  registrations: EventRegistration[];
  eventId?: string;
  canDecide?: boolean;
}) {
  if (registrations.length === 0) {
    return <p className="rounded-xl border border-dashed border-border-strong p-8 text-center text-muted-foreground">Nobody has registered for this event yet.</p>;
  }

  return (
    // SCRUM-74/AC10: more than 15 rows scroll inside the box
    <div data-testid="registration-scroll" className={registrations.length > SCROLL_AFTER_ROWS ? "max-h-128 overflow-y-auto rounded-xl" : undefined}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Contact number</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Registered</TableHead>
            {canDecide && <TableHead>Decision</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {registrations.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-semibold text-foreground">
                <span className="flex flex-wrap items-center gap-2">
                  {r.name}
                  {/* SCRUM-170: why Confirmed can be past the cap */}
                  {r.is_vip && <StatusBadge label="VIP" tone="info" icon="badge-check" />}
                </span>
              </TableCell>
              <TableCell>{r.email}</TableCell>
              <TableCell>{r.phone}</TableCell>
              <TableCell><RegistrationStatusBadge status={r.status} /></TableCell>
              <TableCell>{formatRegistered(r.registered_at)}</TableCell>
              {canDecide && (
                <TableCell>{eventId && r.status === "pending" && <RegistrationDecision eventId={eventId} registrationId={r.id} />}</TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
