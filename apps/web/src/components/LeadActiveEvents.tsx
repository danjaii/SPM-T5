"use client";

import { CalendarX, SearchX } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import EventStatusBadge, { statusLabel } from "@/components/EventStatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatEventDateTime } from "@/lib/formatEventDateTime";
import type { LeadActiveEvent } from "@/lib/leadServer";

const ALL = "all";
const NOT_SPECIFIED = "Not specified";

type Item = { value: string; label: string };

/** The filter's choices: "All" first, then each distinct value in the list, by label. */
const choices = (all: string, pairs: Item[]): Item[] => [
  { value: ALL, label: all },
  ...[...new Map(pairs.map((p) => [p.value, p])).values()].sort((a, b) => a.label.localeCompare(b.label)),
];

function Filter({ label, items, value, onChange }: { label: string; items: Item[]; value: string; onChange: (v: string) => void }) {
  return (
    <label className="grid gap-1 text-sm">
      {label}
      <Select items={items} value={value} onValueChange={(v) => v && onChange(v)}>
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function Empty({ icon: Icon, text, children }: { icon: typeof CalendarX; text: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card px-6 py-10 text-center">
      <Icon className="size-6 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{text}</p>
      {children}
    </div>
  );
}

/**
 * SCRUM-189: every active event, with who is running it, filtered by coordinator, status and name. The list is the whole
 * set the Lead can see, already loaded, so the filters narrow it here rather than asking event-service again (AC3).
 */
export function LeadActiveEvents({ events }: { events: LeadActiveEvent[] }) {
  const [coordinator, setCoordinator] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [search, setSearch] = useState("");

  if (events.length === 0) return <Empty icon={CalendarX} text="No events are active right now." />;

  // Only values that appear in the list, so no choice can lead straight to an empty result
  const coordinators = choices("All coordinators", events.flatMap((e) => (e.coordinator ? [{ value: e.coordinator.id, label: e.coordinator.full_name }] : [])));
  const statuses = choices("All statuses", events.map((e) => ({ value: e.status, label: statusLabel(e.status) })));

  const term = search.trim().toLowerCase();
  const shown = events.filter(
    (e) =>
      (coordinator === ALL || e.coordinator?.id === coordinator) &&
      (status === ALL || e.status === status) &&
      (term === "" || e.name.toLowerCase().includes(term)),
  );
  const filtered = coordinator !== ALL || status !== ALL || term !== "";
  const clear = () => {
    setCoordinator(ALL);
    setStatus(ALL);
    setSearch("");
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_14rem_14rem_auto]">
        <label className="grid gap-1 text-sm">
          Search
          <Input type="search" placeholder="Event name" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <Filter label="Coordinator" items={coordinators} value={coordinator} onChange={setCoordinator} />
        <Filter label="Status" items={statuses} value={status} onChange={setStatus} />
        {filtered && (
          <Button variant="outline" onClick={clear}>
            Clear filters
          </Button>
        )}
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {filtered ? `Showing ${shown.length} of ${events.length} active events` : `${events.length} active ${events.length === 1 ? "event" : "events"}`}
      </p>

      {shown.length === 0 ? (
        <Empty icon={SearchX} text="No events match these filters.">
          <Button variant="outline" onClick={clear}>
            Clear filters
          </Button>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Coordinator</TableHead>
                <TableHead>Preferred date and time</TableHead>
                <TableHead>Expected attendance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">
                    <Link className="underline-offset-4 hover:underline" href={`/lead/events/${e.id}`}>
                      {e.name}
                    </Link>
                  </TableCell>
                  <TableCell><EventStatusBadge status={e.status} /></TableCell>
                  <TableCell>{e.coordinator?.full_name ?? NOT_SPECIFIED}</TableCell>
                  <TableCell>
                    {e.preferred_start_datetime ? formatEventDateTime(e.preferred_start_datetime, e.preferred_end_datetime) : NOT_SPECIFIED}
                  </TableCell>
                  <TableCell>{e.expected_attendance ?? NOT_SPECIFIED}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
