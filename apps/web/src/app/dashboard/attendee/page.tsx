import type { Metadata } from "next";
import { DashboardView } from "@/components/DashboardView";
import { getDashboard } from "@/lib/dashboard";

// Rendered per request: the content depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Attendee dashboard · ConnectSphere" };

export default async function AttendeeDashboard() {
  return <DashboardView data={await getDashboard("attendee")} />;
}
