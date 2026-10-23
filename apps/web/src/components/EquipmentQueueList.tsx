import Link from "next/link";
import { Inbox } from "lucide-react";
import { EQUIPMENT_REQUEST_REVIEW_MESSAGES } from "@spm-t5/shared";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { groupQueueByEvent } from "@/lib/equipmentQueue";
import type { EquipmentQueueItemView } from "@/lib/equipmentRequests";
import { EQUIPMENT_STATUS_DISPLAY } from "@/lib/status";
import { cn } from "@/lib/utils";
import { EquipmentStatusDialog } from "./equipment/EquipmentStatusDialog";

const itemCount = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;

// SCRUM-87/AC1: the requests waiting for action, soonest event first (equipment-service orders them). AC2: none shows the
// spec's message. SCRUM-88/AC2: a request the coordinator changed is marked Updated. SCRUM-113/AC3: one sent back after an
// event change says so.
// SCRUM-136/AC2 (Figma frame 11): one card per event on the left, the chosen event's items on the right, each with an
// Update status action. The chosen event is in the address (`?event=`), so the page renders on the server; the first
// event is open by default. AC8: below the lg breakpoint the list sits above the items, and each row stacks into a card.
export function EquipmentQueueList({ requests, selectedEventId }: { requests: EquipmentQueueItemView[]; selectedEventId?: string }) {
  // SCRUM-136/AC10: a designed empty state, not a bare line.
  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
        <Inbox aria-hidden="true" className="size-8 text-muted-foreground" />
        <p className="font-semibold text-foreground">{EQUIPMENT_REQUEST_REVIEW_MESSAGES.queueEmpty}</p>
        <p className="text-sm text-muted-foreground">New requests from coordinators will show up here, soonest event first.</p>
      </div>
    );
  }

  const groups = groupQueueByEvent(requests);
  const open = groups.find((g) => g.eventId === selectedEventId) ?? groups[0];

  return (
    <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
      <nav aria-label="Events with waiting requests" className="flex flex-col gap-3">
        {groups.map((g) => {
          const current = g.eventId === open.eventId;
          return (
            <Link
              key={g.eventId}
              href={`/equipment-requests?event=${encodeURIComponent(g.eventId)}`}
              aria-current={current ? "true" : undefined}
              className={cn(
                "flex flex-col gap-1 rounded-xl border bg-card p-4 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                current ? "border-2 border-primary" : "border-border",
              )}
            >
              <span className="font-semibold text-foreground">{g.eventName}</span>
              <span className="text-sm text-muted-foreground">{g.eventDate} · {itemCount(g.items.length)}</span>
            </Link>
          );
        })}
      </nav>

      <section aria-labelledby="queue-event-heading" className="lg:col-span-2">
        <Card className="gap-4 p-6">
          <div>
            <h2 id="queue-event-heading" className="text-xl font-bold text-foreground">{open.eventName}</h2>
            <p className="text-sm text-muted-foreground">{open.eventDate} · {itemCount(open.items.length)} waiting</p>
          </div>
          <Table>
            <TableHeader className="max-md:sr-only">
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Need</TableHead>
                <TableHead>Venue</TableHead>
                <TableHead>Status</TableHead>
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {open.items.map((r) => (
                <TableRow key={r.id} className="max-md:flex max-md:flex-col max-md:gap-1 max-md:p-3">
                  <TableCell className="whitespace-normal max-md:p-0">
                    <Link
                      href={`/equipment-requests/${r.id}`}
                      className="font-semibold text-fg-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {r.equipment}
                    </Link>
                  </TableCell>
                  <TableCell className="max-md:p-0">{r.quantity}</TableCell>
                  <TableCell className="whitespace-normal max-md:p-0">{r.venueName ?? "No venue"}</TableCell>
                  <TableCell className="whitespace-normal max-md:p-0">
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge {...EQUIPMENT_STATUS_DISPLAY[r.status]} label={r.statusLabel} />
                      {r.updated && <StatusBadge tone="info" icon="info" label="Updated" />}
                      {/* SCRUM-113/AC3: the event changed since it was arranged; its page says what changed */}
                      {r.sentBack && <StatusBadge tone="warning" label="Sent back for review" />}
                    </div>
                  </TableCell>
                  <TableCell className="max-md:p-0">
                    <EquipmentStatusDialog request={r} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </section>
    </div>
  );
}
