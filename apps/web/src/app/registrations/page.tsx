import type { Metadata } from "next";
import { MyRegistrationList } from "@/components/MyRegistrationList";
import { PageFrame } from "@/components/PageFrame";
import { getMyRegistrations } from "@/lib/eventRegistrationServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "My registrations · ConnectSphere" };

// SCRUM-83/AC15: the attendee's "My registrations".
// SCRUM-139/AC1, AC5, AC11: inside the shared shell (its "My registrations" item is highlighted), with an error state.
export default async function MyRegistrationsPage() {
  const result = await getMyRegistrations();

  return (
    <PageFrame
      title="My registrations"
      description="Your places at upcoming events. Withdraw here if you can no longer go."
      // Couldn't load: say so, rather than "You have not registered for an event" (SCRUM-72/AC5)
      error={"error" in result ? result.error : undefined}
    >
      {"registrations" in result && <MyRegistrationList registrations={result.registrations} />}
    </PageFrame>
  );
}
