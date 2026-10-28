"use client";

import { Search, X } from "lucide-react";
import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { matchesSearch } from "@/lib/eventSearch";
import type { UpcomingEvent } from "@/lib/getUpcomingEvents";
import { UpcomingEventList } from "./UpcomingEventList";

// SCRUM-9: the attendee's List of events with a search box. The cards narrow as the person types (no Search button); the x, or
// Escape, empties the box. What matches is decided by matchesSearch (docs/specs/event-search.md).
export function EventSearch({ events }: { events: UpcomingEvent[] }) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);

  // SCRUM-9/AC3 (9-S23): with no upcoming events at all there is nothing to search, so the list keeps its own message
  if (events.length === 0) return <UpcomingEventList events={events} />;

  const shown = events.filter((event) => matchesSearch(event, query));

  function clear() {
    setQuery("");
    input.current?.focus();
  }

  return (
    <div className="space-y-4">
      {/* SCRUM-9/AC1: one box that searches name, client organisation, date, venue, status, category and coordinator */}
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={input}
          type="search"
          className="pr-10 pl-9 [&::-webkit-search-cancel-button]:hidden"
          aria-label="Search events"
          placeholder="Search by name, organisation, date, venue, status, category or coordinator"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") clear();
          }}
        />
        {query !== "" && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={clear}
            className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        )}
      </div>
      {/* SCRUM-9/AC3: events exist but none match: say so, and say what was typed */}
      {shown.length === 0 ? (
        <p role="status" className="rounded-xl border border-dashed border-border-strong p-8 text-center text-muted-foreground">{`No events match "${query.trim()}"`}</p>
      ) : (
        <UpcomingEventList events={shown} />
      )}
    </div>
  );
}
