"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseCalendarRange } from "@spm-t5/shared";
import { AuthAlert } from "@/components/auth/AuthParts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchVenueCalendar, type CalendarQuery, type VenueCalendarData } from "@/lib/venueCalendar";
import { VenueCalendarRangeForm } from "./VenueCalendarRangeForm";
import { VenueCalendarVenue } from "./VenueCalendarVenue";

// SCRUM-84/AC1 + AC5: the venue availability calendar. Opens on the current week (no dates sent); choosing dates asks venue-service
// again. The last good answer stays on screen while a new one loads.
export function VenueCalendar() {
  const router = useRouter();
  const [calendar, setCalendar] = useState<VenueCalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const shown = useRef<CalendarQuery>({}); // the dates last applied, so Reload asks for the same ones
  const pending = useRef<AbortController | null>(null);
  const routerRef = useRef(router); // read when a reply arrives, so a new router object never re-runs the first load
  routerRef.current = router;

  const load = useCallback(
    async (query: CalendarQuery) => {
      // SCRUM-84/AC6: the same check venue-service makes, so a bad range is refused here and the previous view stays
      const checked = parseCalendarRange(query, new Date());
      if (!checked.ok) {
        setFieldErrors(checked.fieldErrors);
        return;
      }
      pending.current?.abort();
      const controller = new AbortController();
      pending.current = controller;
      setLoading(true);
      try {
        const result = await fetchVenueCalendar(query, controller.signal);
        if (result.kind === "ok") {
          shown.current = query;
          setCalendar(result.calendar);
          setMessage(null);
          setFieldErrors({});
        } else if (result.kind === "invalid") setFieldErrors(result.fieldErrors);
        else if (result.kind === "unauthenticated") routerRef.current.replace("/login");
        else if (result.kind === "error" || result.kind === "forbidden") setMessage(result.message);
      } catch {
        return; // replaced by a newer request
      }
      setLoading(false);
    },
    [],
  );

  useEffect(() => {
    void load({});
    return () => pending.current?.abort();
  }, [load]);

  const range = calendar?.range;
  return (
    <div className="flex flex-col gap-6">
      <VenueCalendarRangeForm busy={loading} fieldErrors={fieldErrors} onSubmit={load} />
      <Button type="button" variant="outline" className="self-start" disabled={loading} onClick={() => void load(shown.current)}>
        <RefreshCw aria-hidden="true" /> Reload
      </Button>
      {message && <AuthAlert tone="error">{message}</AuthAlert>}
      {range && <p className="text-sm font-medium text-foreground">{range.from === range.to ? `Showing ${range.from}` : `Showing ${range.from} to ${range.to}`}</p>}
      {!calendar ? (
        loading && <CalendarSkeleton />
      ) : calendar.venues.length === 0 ? (
        <p className="text-sm text-muted-foreground">There are no venues to show.</p>
      ) : (
        <div aria-busy={loading} className="flex flex-col gap-4">
          {calendar.venues.map((venue) => (
            <VenueCalendarVenue key={venue.id} venue={venue} />
          ))}
        </div>
      )}
    </div>
  );
}

export function CalendarSkeleton() {
  return (
    <div role="status" aria-label="Loading the venue calendar" className="flex flex-col gap-4">
      {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-28 w-full" />)}
    </div>
  );
}
