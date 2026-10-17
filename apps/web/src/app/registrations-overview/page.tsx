import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { EventPicker } from "@/components/EventPicker";
import { EventRegistrationList } from "@/components/EventRegistrationList";
import { RegistrationSummary } from "@/components/RegistrationSummary";
import { getEventRegistrations, getManagedEvents } from "@/lib/eventRegistrationServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Event registrations · ConnectSphere" };

// SCRUM-74: organisers and coordinators pick one of the events they manage and see its registrations
export default async function RegistrationsOverviewPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: selectedId } = await searchParams;
  const result = await getManagedEvents();
  const events = "events" in result ? result.events : [];
  // SCRUM-74/AC3: the event chosen in the dropdown; its capacity comes from the caller's own list
  const selected = events.find((e) => e.id === selectedId);
  // SCRUM-74/AC1: only one of their own events; an id typed into the address that isn't theirs is ignored
  const registrations = selected ? await getEventRegistrations(selected.id) : null;

  return (
    <>
      <AppHeader />
      <main className="dash__main">
        <Link className="back-link" href="/dashboard">← Back to dashboard</Link>
        <h1>Event registrations</h1>
        {"error" in result ? (
          // SCRUM-74/AC1: refused (not an organiser or coordinator) or couldn't load: say so, rather than "no events"
          <div className="alert alert--error" role="alert">{result.error}</div>
        ) : events.length === 0 ? (
          // SCRUM-74/AC4: no events under them
          <p className="empty">You have no events to manage yet.</p>
        ) : (
          <>
            <EventPicker events={events} selectedId={selected?.id ?? null} />
            {!selected && <p className="empty">Choose an event to see its registrations.</p>}
          </>
        )}
        {registrations &&
          ("registrations" in registrations ? (
            <>
              <RegistrationSummary registrations={registrations.registrations} capacity={selected?.registration_capacity ?? null} />
              <EventRegistrationList registrations={registrations.registrations} />
            </>
          ) : (
            // Couldn't load: say so, rather than an empty page
            <div className="alert alert--error" role="alert">{registrations.error}</div>
          ))}
      </main>
    </>
  );
}
