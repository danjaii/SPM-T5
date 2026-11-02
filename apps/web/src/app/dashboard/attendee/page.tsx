import type { Metadata } from "next";
import Link from "next/link";
import { AttendeeDashboardOverview } from "@/components/AttendeeDashboardOverview";
import { BfcacheGuard } from "@/components/BfcacheGuard";
import { LeadKpiCards } from "@/components/LeadKpiCards";
import { PageFrame } from "@/components/PageFrame";
import { buttonVariants } from "@/components/ui/button";
import { attendeeKpis, homeSummary, welcome } from "@/lib/attendeeDashboard";
import { getMyRegistrations } from "@/lib/eventRegistrationServer";
import { getUpcomingEvents } from "@/lib/getUpcomingEvents";
import { getShellData } from "@/lib/shellServer";

// Rendered per request: the content depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Home · ConnectSphere" };

/**
 * SCRUM-161 (Figma 20): the attendee's Home: a greeting, three figures, their registrations and the events open to register
 * for. The List of events moved to Browse events. Each source stands alone: one that fails shows "could not be loaded".
 */
export default async function AttendeeHome() {
  const [mine, upcoming, shell] = await Promise.all([getMyRegistrations(), getUpcomingEvents(), getShellData()]);
  const registrations = "registrations" in mine ? mine.registrations : undefined;
  const events = "events" in upcoming ? upcoming.events : undefined;
  const kpis = registrations ? attendeeKpis(registrations) : [];

  return (
    <PageFrame
      title={welcome(shell?.user.fullName)}
      description={homeSummary(registrations)}
      action={<Link href="/dashboard/attendee/browse" className={buttonVariants()}>Browse events</Link>}
    >
      <BfcacheGuard />
      {kpis.length > 0 && <LeadKpiCards kpis={kpis} />}
      <AttendeeDashboardOverview registrations={registrations} events={events} />
    </PageFrame>
  );
}
