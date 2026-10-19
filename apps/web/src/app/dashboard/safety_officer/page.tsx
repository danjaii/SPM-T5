import type { Metadata } from "next";
import { DashboardView } from "@/components/DashboardView";
import { getDashboard } from "@/lib/dashboard";

// Rendered per request: the content depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Safety Officer dashboard · ConnectSphere" };

/** SCRUM-116/AC4: the Safety Officer home page. SCRUM-99/AC2: DashboardView adds the link to the events waiting for a safety check. */
export default async function SafetyOfficerDashboard() {
  return <DashboardView data={await getDashboard("safety_officer")} />;
}
