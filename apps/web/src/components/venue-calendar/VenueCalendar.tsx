"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { formatShortSgt } from "@spm-t5/shared";
import { AuthAlert } from "@/components/auth/AuthParts";
import { SELECT, VenueUnavailabilityForm } from "@/components/VenueUnavailabilityForm";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchVenueCalendar, type CalendarQuery, type VenueCalendarData } from "@/lib/venueCalendar";
import { affectedBlocks, stepAnchor, todaySgt, viewRange, type CalendarView } from "@/lib/venueTimeline";
import { NewBookingButton, type BookableEvent } from "./NewBookingButton";
import { VenueCalendarLegend } from "./VenueCalendarLegend";
import { VenueCalendarToolbar } from "./VenueCalendarToolbar";
import { VenueDayView } from "./VenueDayTimeline";
import { VenueMonthGrid } from "./VenueMonthGrid";
import { VenueWeekGrid } from "./VenueWeekGrid";


// SCRUM-84/AC1, SCRUM-130 (Figma 09): the venue availability calendar. Opens on today's day view; Day, Week, Month and the date
// stepper each ask venue-service for their range. The last good answer stays on screen while a new one loads.
export function VenueCalendar({
  heading,
  canMarkUnavailable = false,
  bookableEvents,
  now,
}: {
  /** The page title block, shown with Mark venue unavailable and New booking beside it. */
  heading?: ReactNode;
  canMarkUnavailable?: boolean;
  /** Only for an Event Coordinator: their events that can take a venue request, for New booking. */
  bookableEvents?: BookableEvent[];
  /** For tests: the clock. */
  now?: Date;
}) {
  const router = useRouter();
  const today = todaySgt(now);
  const [view, setView] = useState<CalendarView>("day");
  const [anchor, setAnchor] = useState(today);
  const [calendar, setCalendar] = useState<VenueCalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [marking, setMarking] = useState(false); // SCRUM-130/AC3: the Mark unavailable dialog is open
  const [markVenue, setMarkVenue] = useState("");
  const pending = useRef<AbortController | null>(null);
  const routerRef = useRef(router); // read when a reply arrives, so a new router object never re-runs a load
  routerRef.current = router;

  // Every range comes from a view (a day, a week or a month), so it is always one venue-service accepts. Should it refuse one
  // anyway (SCRUM-84/AC6), its message is shown and the previous view stays.
  const load = useCallback(async (query: CalendarQuery) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    try {
      const result = await fetchVenueCalendar(query, controller.signal);
      if (result.kind === "ok") {
        setCalendar(result.calendar);
        setMessage(null);
      } else if (result.kind === "invalid") setMessage(Object.values(result.fieldErrors).join(" "));
      else if (result.kind === "unauthenticated") routerRef.current.replace("/login");
      else setMessage(result.message);
    } catch {
      return; // replaced by a newer request
    }
    setLoading(false);
  }, []);

  const { from, to } = viewRange(view, anchor);
  const reload = useCallback(() => void load({ from, to }), [load, from, to]);
  useEffect(() => {
    reload();
    return () => pending.current?.abort();
  }, [reload]);

  const show = (nextView: CalendarView, nextAnchor: string) => {
    setView(nextView);
    setAnchor(nextAnchor);
  };

  const venues = calendar?.venues ?? [];
  const markingName = venues.find((v) => v.id === markVenue)?.name;

  return (
    <div className="flex flex-col gap-4">
      {/* Figma 09: the page title on the left, Mark venue unavailable and New booking on the right */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">{heading}</div>
        <div className="flex flex-wrap gap-3">
          {/* SCRUM-130/AC3: only Venue Staff are given this (the page decides; the service and the database check it again) */}
          {canMarkUnavailable && (
            <Button type="button" variant="outline" disabled={venues.length === 0} onClick={() => { setMarkVenue(venues[0].id); setMarking(true); }}>
              Mark venue unavailable
            </Button>
          )}
          {bookableEvents && <NewBookingButton events={bookableEvents} />}
        </div>
      </div>
      {/* Figma 09: the view and date controls on the left, the status legend on the right */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <VenueCalendarToolbar
          view={view}
          anchor={anchor}
          busy={loading}
          onView={(next) => show(next, anchor)}
          onStep={(direction) => show(view, stepAnchor(view, anchor, direction))}
          onToday={() => show(view, today)}
        />
        <VenueCalendarLegend />
      </div>

      {/* SCRUM-130/AC2 (Figma 09 banner): a closure that lies over confirmed bookings is called out above the calendar */}
      {affectedBlocks(venues).map((block) => (
        <Alert key={`${block.venue.id}-${block.start}`} className="flex-row items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <div>
              <AlertTitle>
                {block.venue.name} is unavailable {formatShortSgt(new Date(block.start))} to {formatShortSgt(new Date(block.end))}
                {block.reasonLabel ? ` (${block.reasonLabel})` : ""}
              </AlertTitle>
              <AlertDescription>Confirmed bookings in this period are affected. They were kept, and their coordinators were told.</AlertDescription>
            </div>
          </div>
          {canMarkUnavailable && (
            <Link href="/booking-queue" className={buttonVariants({ variant: "outline", size: "sm" })}>View affected bookings</Link>
          )}
        </Alert>
      ))}

      {message && <AuthAlert tone="error">{message}</AuthAlert>}
      {!calendar ? (
        loading && <CalendarSkeleton />
      ) : venues.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">There are no venues to show.</p>
      ) : (
        <div aria-busy={loading} className="flex flex-col gap-4">
          {view === "day" ? (
            <VenueDayView key={from} venues={venues} date={from} now={now} />
          ) : view === "week" ? (
            <VenueWeekGrid venues={venues} from={from} to={to} today={today} onOpenDay={(day) => show("day", day)} />
          ) : (
            <VenueMonthGrid venues={venues} from={from} to={to} today={today} onOpenDay={(day) => show("day", day)} />
          )}
          {/* SCRUM-130/AC1 (Figma 09 and 09a): how setup and turnaround are drawn, and that they count as occupied */}
          <p className="text-sm text-muted-foreground">
            {view === "week"
              ? "The bar at the top of each day shows occupied hours from 08:00 to 22:00. Grey segments either side of a booking are setup and turnaround time; they count as occupied when checking conflicts. Select any period to see its details."
              : "Dashed blocks either side of each booking are the venue's setup and turnaround time. They count as occupied when checking conflicts."}
          </p>
        </div>
      )}

      <Dialog open={marking} onOpenChange={setMarking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark {markingName ?? "a venue"} unavailable</DialogTitle>
            <DialogDescription>Bookings in this period are flagged and their coordinators told. Times are Singapore time.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="markVenue" className="text-sm font-semibold text-foreground">Venue</label>
            <select id="markVenue" className={SELECT} value={markVenue} onChange={(e) => setMarkVenue(e.target.value)}>
              {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          {markVenue && (
            <VenueUnavailabilityForm
              key={markVenue}
              venueId={markVenue}
              onSaved={() => {
                setMarking(false);
                reload(); // SCRUM-130/AC3: show the new block straight away
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function CalendarSkeleton() {
  return (
    <div role="status" aria-label="Loading the venue calendar" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <Skeleton className="h-6 w-full" />
      {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}
    </div>
  );
}
