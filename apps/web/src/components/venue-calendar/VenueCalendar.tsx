"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthAlert } from "@/components/auth/AuthParts";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchVenueCalendar, type VenueCalendarData } from "@/lib/venueCalendar";
import { VenueCalendarVenue } from "./VenueCalendarVenue";

type View = { state: "loading" } | { state: "ready"; calendar: VenueCalendarData } | { state: "error"; message: string };

// SCRUM-84/AC1: the venue availability calendar. Opens on the current week (no dates sent); the venues come from venue-service.
export function VenueCalendar() {
  const router = useRouter();
  const [view, setView] = useState<View>({ state: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetchVenueCalendar({}, controller.signal)
      .then((result) => {
        if (result.kind === "ok") setView({ state: "ready", calendar: result.calendar });
        else if (result.kind === "unauthenticated") router.replace("/login");
        else if (result.kind === "error" || result.kind === "forbidden") setView({ state: "error", message: result.message });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [router]);

  if (view.state === "loading") return <CalendarSkeleton />;
  if (view.state === "error") return <AuthAlert tone="error">{view.message}</AuthAlert>;
  if (view.calendar.venues.length === 0) return <p className="text-sm text-muted-foreground">There are no venues to show.</p>;
  return (
    <div className="flex flex-col gap-4">
      {view.calendar.venues.map((venue) => (
        <VenueCalendarVenue key={venue.id} venue={venue} />
      ))}
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
