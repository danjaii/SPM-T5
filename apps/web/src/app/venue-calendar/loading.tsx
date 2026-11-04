import { CalendarSkeleton } from "@/components/venue-calendar/VenueCalendar";
import { PAGE_MAIN, PageTitle } from "@/components/PageFrame";

// SCRUM-84/AC1: the shape of the page while it loads.
export default function Loading() {
  return (
    <main className={PAGE_MAIN} aria-busy="true" aria-label="Loading the venue calendar">
      <PageTitle>Venue calendar</PageTitle>
      <CalendarSkeleton />
    </main>
  );
}
