import type { Metadata } from "next";
import { BfcacheGuard } from "@/components/BfcacheGuard";
import { EventSearch } from "@/components/EventSearch";
import { PageFrame } from "@/components/PageFrame";
import { getUpcomingEvents } from "@/lib/getUpcomingEvents";

// Rendered per request: the content depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Browse events · ConnectSphere" };

// SCRUM-71/AC1: the attendee's home is the List of events, one card per upcoming event.
// SCRUM-139/AC1, AC5, AC11: inside the shared shell (its "Browse events" item), with an error state when the list can't load.
export default async function AttendeeDashboard() {
  const upcoming = await getUpcomingEvents();

  return (
    <PageFrame
      title="Browse events"
      description="Find an upcoming event and register in a few clicks."
      // SCRUM-71/AC11: couldn't load the list: say so, rather than "No upcoming events"
      error={"error" in upcoming ? upcoming.error : undefined}
    >
      <BfcacheGuard />
      {"events" in upcoming && <EventSearch events={upcoming.events} />}
    </PageFrame>
  );
}
