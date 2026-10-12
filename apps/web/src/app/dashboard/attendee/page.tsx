import type { Metadata } from "next";
import Link from "next/link";
import { DashboardView } from "@/components/DashboardView";
import { EventSearch } from "@/components/EventSearch";
import { getDashboard } from "@/lib/dashboard";
import { getUpcomingEvents } from "@/lib/getUpcomingEvents";

// Rendered per request: the content depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Attendee dashboard · ConnectSphere" };

export default async function AttendeeDashboard() {
  // Both loaded at once: the tables come from auth-service, the List of events from event-service
  const [data, upcoming] = await Promise.all([getDashboard("attendee"), getUpcomingEvents()]);

  return (
    <DashboardView data={data}>
      {/* SCRUM-71/AC1: the List of events, one card per upcoming event */}
      <section className="dash__section">
        <h2>List of events</h2>
        {/* SCRUM-83/AC15: the attendee's registrations, from event-service */}
        <Link href="/registrations">My registrations</Link>
        {"events" in upcoming ? (
          <EventSearch events={upcoming.events} />
        ) : (
          // SCRUM-71/AC11: couldn't load the list: say so, rather than "No upcoming events"
          <div className="alert alert--error" role="alert">{upcoming.error}</div>
        )}
      </section>
    </DashboardView>
  );
}
