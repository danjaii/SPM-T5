import type { Metadata } from "next";
import { DashboardView } from "@/components/DashboardView";
import { UpcomingEventList } from "@/components/UpcomingEventList";
import { getDashboard } from "@/lib/dashboard";
import { getUpcomingEvents } from "@/lib/getUpcomingEvents";

// Rendered per request: the content depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Attendee dashboard · ConnectSphere" };

export default async function AttendeeDashboard() {
  // Both loaded at once: the tables come from auth-service, the List of events from event-service
  const [data, { events }] = await Promise.all([getDashboard("attendee"), getUpcomingEvents()]);

  return (
    <DashboardView data={data}>
      {/* SCRUM-71/AC1: the List of events, one card per upcoming event */}
      <section className="dash__section">
        <h2>List of events</h2>
        <UpcomingEventList events={events} />
      </section>
    </DashboardView>
  );
}
