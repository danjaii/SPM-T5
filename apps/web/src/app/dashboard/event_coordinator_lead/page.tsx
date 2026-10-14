import type { Metadata } from "next";
import { DashboardView } from "@/components/DashboardView";
import { getDashboard } from "@/lib/dashboard";

// Rendered per request: the content depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Event Coordinator Lead dashboard · ConnectSphere" };

/** SCRUM-75/AC4: the Lead home page. DashboardView adds the links to the unassigned queue and coordinator overview. */
export default async function EventCoordinatorLeadDashboard() {
  return <DashboardView data={await getDashboard("event_coordinator_lead")} />;
}
