import type { Metadata } from "next";
import { BfcacheGuard } from "@/components/BfcacheGuard";
import { MyEventRequestsList } from "@/components/MyEventRequestsList";
import { PageFrame } from "@/components/PageFrame";
import { getDashboard } from "@/lib/dashboard";
import { getMyEventRequests } from "@/lib/myEventRequestsServer";
import { roleLabel } from "@/lib/roles";

// Rendered per request: the content depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Event Organiser dashboard · ConnectSphere" };

/**
 * SCRUM-159/AC1: the organiser's home in the new design, inside the shared app shell, under the same title and line. It
 * shows every event request, the same list as My event requests (SCRUM-52), so the old 25-row preview and its link to the
 * full list are no longer needed; the sidebar item and page stay. The old row of links (My profile, My event requests,
 * Event registrations) is left out: the sidebar gives the same three.
 */
export default async function EventOrganiserDashboard() {
  const [{ user }, requests] = await Promise.all([getDashboard("event_organiser"), getMyEventRequests()]);

  return (
    <PageFrame title={`${roleLabel(user.role)} dashboard`} description={`Signed in as ${user.fullName}`}>
      <BfcacheGuard />
      <MyEventRequestsList result={requests} title="My event requests" />
    </PageFrame>
  );
}
