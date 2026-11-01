import type { Metadata } from "next";
import { BfcacheGuard } from "@/components/BfcacheGuard";
import { OrganiserHome } from "@/components/OrganiserHome";
import { PageFrame } from "@/components/PageFrame";
import { getOrganiserHome } from "@/lib/organiserHomeServer";

// Rendered per request: the content depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "My events · ConnectSphere" };

const DESCRIPTION = "Every request you have made, from draft to confirmed.";

/**
 * SCRUM-159 (Figma 02): the organiser's home, "My events": a banner when a coordinator is waiting on a reply, four figures,
 * tabs, and every event request with its coordinator and status. The My event requests page (SCRUM-52) stays, as its
 * acceptance criteria and sidebar item require.
 */
export default async function EventOrganiserDashboard() {
  const result = await getOrganiserHome();
  if ("error" in result) return <PageFrame title="My events" description={DESCRIPTION} error={result.error} />;

  return (
    <PageFrame title="My events" description={DESCRIPTION}>
      <BfcacheGuard />
      <OrganiserHome events={result.events} now={new Date().toISOString()} />
    </PageFrame>
  );
}
