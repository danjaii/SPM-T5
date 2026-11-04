import type { Metadata } from "next";
import { VenueCalendar } from "@/components/venue-calendar/VenueCalendar";
import { PAGE_MAIN, PageTitle } from "@/components/PageFrame";

export const metadata: Metadata = { title: "Venue calendar · ConnectSphere" };

// SCRUM-84/AC1: the venue availability calendar, for Event Coordinators, Venue Staff and Technical Support Staff (middleware.ts guards it).
export default function VenueCalendarPage() {
  return (
    <main className={PAGE_MAIN}>
      <div className="flex flex-col gap-1.5">
        <PageTitle>Venue calendar</PageTitle>
        <p className="text-sm text-muted-foreground">Every venue&apos;s status across the dates you choose. Times are Singapore time.</p>
      </div>
      <VenueCalendar />
    </main>
  );
}
