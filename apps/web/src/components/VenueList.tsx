"use client";

import { Building2, Search, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export interface VenueSummary {
  id: string;
  name: string;
  address: string;
  max_capacity: number;
}

// SCRUM-29 AC1: the venue catalogue — each venue's name (linking to its details), location and maximum capacity.
// SCRUM-129: a card list with a live filter, so a coordinator can compare venues without scrolling the whole catalogue.
export function VenueList({ venues }: { venues: VenueSummary[] }) {
  const [filter, setFilter] = useState("");

  // SCRUM-29 AC5, SCRUM-129/AC10: an empty catalogue gets a designed empty state, not an empty list
  if (venues.length === 0) {
    return (
      <Card className="items-center py-10 text-center">
        <Building2 aria-hidden="true" className="size-8 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">No venues in the catalogue yet.</p>
      </Card>
    );
  }

  const needle = filter.trim().toLowerCase();
  const shown = needle ? venues.filter((v) => `${v.name} ${v.address}`.toLowerCase().includes(needle)) : venues;

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label="Filter venues"
          placeholder="Filter venues by name or location"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="pl-9"
        />
      </div>
      <p className="text-sm text-muted-foreground" role="status">
        {shown.length} {shown.length === 1 ? "venue" : "venues"}
      </p>
      {shown.length === 0 ? (
        <Card className="items-center py-8 text-center">
          <p className="text-sm font-medium text-foreground">{`No venues match "${filter.trim()}".`}</p>
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {shown.map((v) => (
            <li key={v.id}>
              <Card className="h-full flex-row items-start gap-3 px-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-fg-primary">
                  <Building2 aria-hidden="true" className="size-5" />
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <Link
                    href={`/venues/${v.id}`}
                    className="font-semibold text-fg-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {v.name}
                  </Link>
                  <span className="text-sm text-muted-foreground">{v.address}</span>
                  <span className="flex items-center gap-1.5 text-sm text-foreground">
                    <Users aria-hidden="true" className="size-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Max capacity</span>
                    <span className="font-semibold">{v.max_capacity}</span>
                  </span>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

