import type { Metadata } from "next";
import { EventRegistrationForm } from "@/components/EventRegistrationForm";
import { Alert } from "@/components/ui/alert";
import { getRegistrationForm } from "@/lib/eventRegistrationServer";
import { BackLink, PAGE_MAIN } from "@/components/PageFrame";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Register for an event · ConnectSphere" };

// SCRUM-83: an attendee registers for an upcoming event (from Register on its List of events card).
// SCRUM-139/AC2, AC5, AC11: inside the shared shell, with an error state when the form can't load.
export default async function RegisterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getRegistrationForm(id);

  return (
    <main className={PAGE_MAIN}>
      <BackLink href="/dashboard/attendee/browse" to="events" />
      {"data" in result ? <EventRegistrationForm data={result.data} /> : <Alert variant="danger">{result.error}</Alert>}
    </main>
  );
}
