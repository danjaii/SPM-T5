import type { Metadata } from "next";
import Link from "next/link";
import { BfcacheGuard } from "@/components/BfcacheGuard";
import { LeadKpiCards } from "@/components/LeadKpiCards";
import { PageFrame } from "@/components/PageFrame";
import { TechnicalSupportDashboardOverview } from "@/components/TechnicalSupportDashboardOverview";
import { buttonVariants } from "@/components/ui/button";
import { getShellData } from "@/lib/shellServer";
import { technicalSupportKpis, newAssignments } from "@/lib/technicalSupportDashboard";
import { getTechnicalSupportDashboard } from "@/lib/technicalSupportDashboardServer";

// Rendered per request: the content depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Technical Support Home · ConnectSphere" };

/**
 * SCRUM-164 (Figma 18): the Technical Support Staff Home: new on-site assignments first, then the equipment requests
 * waiting and the items out of service. It reads equipment requests, not the older technical_support_requests. Each
 * source stands alone: one that fails shows "Unavailable".
 */
export default async function TechnicalSupportStaffDashboard() {
  const [data, shell] = await Promise.all([getTechnicalSupportDashboard(), getShellData()]);
  const { requests, items, notifications } = data;
  const kpis = technicalSupportKpis(requests, items, notifications && newAssignments(notifications));
  const firstName = shell?.user.fullName.split(" ")[0];

  return (
    <PageFrame
      title={firstName ? `Welcome, ${firstName}` : "Welcome"}
      description="What needs your action and where equipment stands."
      action={<Link href="/equipment-requests" className={buttonVariants()}>Open requests</Link>}
    >
      <BfcacheGuard />
      {kpis.length > 0 && <LeadKpiCards kpis={kpis} />}
      <TechnicalSupportDashboardOverview {...data} />
    </PageFrame>
  );
}
