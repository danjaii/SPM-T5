import type { Metadata } from "next";
import { VenueCalendar } from "@/components/venue-calendar/VenueCalendar";

export const metadata: Metadata = { title: "Venue calendar · ConnectSphere" };

// SCRUM-84/AC1: the venue availability calendar, for Event Coordinators, Venue Staff and Technical Support Staff (middleware.ts guards it).
export default function VenueCalendarPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Venue calendar</h1>
        <p className="text-sm text-muted-foreground">Every venue&apos;s status across the dates you choose. Times are Singapore time.</p>
      </div>
      <VenueCalendar />
    </main>
  );
}
