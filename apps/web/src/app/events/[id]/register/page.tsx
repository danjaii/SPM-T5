import type { Metadata } from "next";
import Link from "next/link";
import { EventRegistrationForm } from "@/components/EventRegistrationForm";
import { Alert } from "@/components/ui/alert";
import { getRegistrationForm } from "@/lib/eventRegistrationServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Register for an event · ConnectSphere" };

// SCRUM-83: an attendee registers for an upcoming event (from Register on its List of events card).
// SCRUM-139/AC2, AC5, AC11: inside the shared shell, with an error state when the form can't load.
export default async function RegisterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getRegistrationForm(id);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 p-4 sm:p-6">
      <Link className="text-sm font-medium text-primary underline-offset-4 hover:underline" href="/dashboard/attendee">← Back to events</Link>
      {"data" in result ? <EventRegistrationForm data={result.data} /> : <Alert variant="danger">{result.error}</Alert>}
    </main>
  );
}
