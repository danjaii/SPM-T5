import { formatEventDateTime } from "@/lib/formatEventDateTime";
import type { MyRegistration } from "@/lib/eventRegistration";
import { RegistrationStatusBadge } from "@/components/RegistrationStatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { WithdrawRegistration } from "./WithdrawRegistration";

// SCRUM-83/AC15: the attendee's "My registrations": each registration with its event, when it is, and its status.
// AC6: earlier (Withdrawn/Rejected) registrations stay in the history, so they're listed too.
// SCRUM-139/AC2, AC7: a Table with a StatusBadge (icon + label) for each status.
export function MyRegistrationList({ registrations }: { registrations: MyRegistration[] }) {
  // SCRUM-72/AC5, SCRUM-139/AC11: no registration for an upcoming event (event-service sends only upcoming ones, SCRUM-72/AC1)
  if (registrations.length === 0) {
    return <p className="rounded-xl border border-dashed border-border-strong p-8 text-center text-muted-foreground">You have not registered for an event</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Event</TableHead>
          <TableHead>When</TableHead>
          <TableHead>Where</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {registrations.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="font-semibold text-foreground">{r.event.name}</TableCell>
            <TableCell>{formatEventDateTime(r.event.start_at, r.event.end_at)}</TableCell>
            {/* SCRUM-72/AC4: the location, the venue's name and address (as on the List of events, SCRUM-71/AC3) */}
            <TableCell>{r.event.venue.name ? `${r.event.venue.name}, ${r.event.venue.address}` : "Venue to be confirmed"}</TableCell>
            {/* SCRUM-72/AC3: the status, as an icon and a label */}
            <TableCell><RegistrationStatusBadge status={r.status} /></TableCell>
            {/* SCRUM-73: withdraw from the event */}
            <TableCell><WithdrawRegistration registration={r} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
