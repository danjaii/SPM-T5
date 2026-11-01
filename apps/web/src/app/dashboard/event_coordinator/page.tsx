import type { Metadata } from "next";
import Link from "next/link";
import { CoordinatorDashboardOverview } from "@/components/CoordinatorDashboardOverview";
import { LeadKpiCards } from "@/components/LeadKpiCards";
import { PageFrame } from "@/components/PageFrame";
import { buttonVariants } from "@/components/ui/button";
import { coordinatorKpis, eventsThisWeek, greeting, homeSummary, needsActionCount } from "@/lib/coordinatorDashboard";
import { getCoordinatorDashboard } from "@/lib/coordinatorDashboardServer";

// Rendered per request: the content depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Event Coordinator dashboard · ConnectSphere" };

/**
 * SCRUM-160 (Figma 16): a greeting, the figures, what to act on first and this week's events, then the coordinator's events
 * and venue booking requests by status. The lists themselves stay on Event requests and My venue bookings. A failed source
 * leaves its part "Unavailable" (or its figure out), never 0.
 */
export default async function EventCoordinatorDashboard() {
  const data = await getCoordinatorDashboard();
  const now = new Date();
  const actions = needsActionCount(data.bookings, data.returned);
  const thisWeek = data.events ? eventsThisWeek(data.events, data.bookings, now).length : 0;
  const kpis = coordinatorKpis(data.events, data.bookings, actions, thisWeek);
  return (
    <PageFrame
      title={greeting(data.fullName, now)}
      description={homeSummary(actions)}
      action={<Link href="/venues/search" className={buttonVariants({ variant: "outline" })}>Find a venue</Link>}
    >
      {kpis.length > 0 && <LeadKpiCards kpis={kpis} />}
      <CoordinatorDashboardOverview {...data} now={now} />
    </PageFrame>
  );
}
