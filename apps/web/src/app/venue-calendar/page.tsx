import type { Metadata } from "next";
import { Suspense } from "react";
import { PAGE_MAIN, PageTitle } from "@/components/PageFrame";
import { VenueCalendarForRole } from "@/components/venue-calendar/VenueCalendarForRole";
import { CalendarSkeleton } from "@/components/venue-calendar/VenueCalendar";

export const metadata: Metadata = { title: "Venue calendar · ConnectSphere" };

// The title block; the calendar puts Mark venue unavailable beside it for Venue Staff (Figma 09).
const heading = (
  <div className="flex flex-col gap-1.5">
    <PageTitle>Venue calendar</PageTitle>
    <p className="text-sm text-muted-foreground">Every venue&apos;s bookings, holds and closures, with setup and turnaround time. Times are Singapore time.</p>
  </div>
);

// SCRUM-84/AC1: the venue availability calendar, for Event Coordinators, Venue Staff and Technical Support Staff (middleware.ts guards it).
export default function VenueCalendarPage() {
  return (
    <main className={PAGE_MAIN}>
      <Suspense fallback={<>{heading}<CalendarSkeleton /></>}>
        <VenueCalendarForRole heading={heading} />
      </Suspense>
    </main>
  );
}
