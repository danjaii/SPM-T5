import type { Metadata } from "next";
import { DashboardView } from "@/components/DashboardView";
import { getDashboard } from "@/lib/dashboard";

// Rendered per request: the content depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Venue Staff dashboard · ConnectSphere" };

export default async function VenueStaffDashboard() {
  return <DashboardView data={await getDashboard("venue_staff")} />;
}
