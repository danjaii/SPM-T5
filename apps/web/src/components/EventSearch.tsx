"use client";

import { useRef, useState } from "react";
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
    <div className="event-search">
      {/* SCRUM-9/AC1: one box that searches name, client organisation, date, venue, status, category and coordinator */}
      <div className="event-search__box">
        <input
          ref={input}
          type="search"
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
          <button className="event-search__clear" type="button" aria-label="Clear search" onClick={clear}>
            ×
          </button>
        )}
      </div>
      {/* SCRUM-9/AC3: events exist but none match: say so, and say what was typed */}
      {shown.length === 0 ? (
        <p className="empty" role="status">{`No events match "${query.trim()}"`}</p>
      ) : (
        <UpcomingEventList events={shown} />
      )}
    </div>
  );
}
