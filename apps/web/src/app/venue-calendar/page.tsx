import type { Metadata } from "next";
import { Suspense } from "react";
import { PAGE_MAIN, PageTitle } from "@/components/PageFrame";
import { VenueCalendarForRole } from "@/components/venue-calendar/VenueCalendarForRole";
import { CalendarSkeleton } from "@/components/venue-calendar/VenueCalendar";

export const metadata: Metadata = { title: "Venue calendar · ConnectSphere" };

// SCRUM-84/AC1: the venue availability calendar, for Event Coordinators, Venue Staff and Technical Support Staff (middleware.ts guards it).
export default function VenueCalendarPage() {
  return (
    <main className={PAGE_MAIN}>
      <div className="flex flex-col gap-1.5">
        <PageTitle>Venue calendar</PageTitle>
        <p className="text-sm text-muted-foreground">Every venue&apos;s status across the dates you choose. Times are Singapore time.</p>
      </div>
      <Suspense fallback={<CalendarSkeleton />}>
        <VenueCalendarForRole />
      </Suspense>
    </main>
  );
}
