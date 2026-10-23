import Link from "next/link";
import { Inbox } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { occupiedWindow, suitabilityLabel, timingNote, type QueueItemView } from "@/lib/bookingQueue";

// SCRUM-134/AC6: the Check column is a status, so it is always an icon plus a label. A flagged request is a Conflict.
function CheckBadge({ r }: { r: QueueItemView }) {
  if (r.flags.length > 0) return <StatusBadge tone="danger" label="Conflict" />;
  if (r.suitability === "suitable") return <StatusBadge tone="success" label="Suitable" />;
  if (r.suitability === "not_suitable") return <StatusBadge tone="warning" label={suitabilityLabel(r.suitability)} />;
  return <StatusBadge tone="neutral" label={suitabilityLabel(r.suitability)} />;
}

// SCRUM-37/AC1, AC4, AC5; SCRUM-134/AC1: pending requests oldest first, each with the whole time the venue is taken, setup
// and turnaround included. AC8: below the md breakpoint each row stacks into a card, so nothing scrolls sideways.
export function BookingQueueList({ requests }: { requests: QueueItemView[] }) {
  // SCRUM-134/AC10: a designed empty state, not a bare table.
  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
        <Inbox aria-hidden="true" className="size-8 text-muted-foreground" />
        <p className="font-semibold text-foreground">No pending booking requests.</p>
        <p className="text-sm text-muted-foreground">New requests from coordinators will show up here, oldest first.</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader className="max-md:sr-only">
        <TableRow>
          <TableHead>Request</TableHead>
          <TableHead>Venue</TableHead>
          <TableHead>When</TableHead>
          <TableHead>Check</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {requests.map((r) => {
          const note = timingNote(r);
          return (
            <TableRow key={r.id} className="max-md:flex max-md:flex-col max-md:gap-1 max-md:p-3">
              <TableCell className="whitespace-normal max-md:p-0">
                <Link
                  href={`/booking-queue/${r.id}`}
                  className="font-semibold text-fg-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {r.eventName}
                </Link>
                <p className="text-xs text-muted-foreground">Requested by {r.requestedByName ?? "Unknown"}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {r.amendsRequestId && <StatusBadge tone="info" label="Amends an earlier request" />}
                  {/* SCRUM-104/AC4: text, not colour alone */}
                  {r.flags.length > 0 && <StatusBadge tone="danger" label={`Flagged: ${r.flags.map((f) => f.label).join(", ")}`} />}
                  {/* SCRUM-113/AC3: the event changed since it was approved; its page says what changed */}
                  {r.sentBack && <StatusBadge tone="warning" label="Sent back for review" />}
                </div>
              </TableCell>
              <TableCell className="whitespace-normal max-md:p-0">{r.venueName}</TableCell>
              <TableCell className="whitespace-normal max-md:p-0">
                <span className="font-semibold">{r.date}</span>
                <p className="text-xs">Event {r.startTime}–{r.endTime}</p>
                <p className="text-xs text-muted-foreground">
                  Venue occupied {occupiedWindow(r)}
                  {note && <> ({note})</>}
                </p>
              </TableCell>
              <TableCell className="max-md:p-0">
                <CheckBadge r={r} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
