import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { BfcacheGuard } from "@/components/BfcacheGuard";
import { DashboardSections } from "@/components/dashboard/DashboardSections";
import { PageFrame } from "@/components/PageFrame";
import { getDashboard } from "@/lib/dashboard";
import { roleLabel } from "@/lib/roles";

// Rendered per request: the content depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Event Organiser dashboard · ConnectSphere" };

/**
 * SCRUM-159/AC1: the organiser's home in the new design, inside the shared app shell: the same title, line and "My event
 * requests" table as before, with the link to the full list (SCRUM-52/AC1) under it. The old row of links (My profile, My
 * event requests, Event registrations) is left out: the sidebar gives the same three.
 */
export default async function EventOrganiserDashboard() {
  const { user, sections } = await getDashboard("event_organiser");

  return (
    <PageFrame title={`${roleLabel(user.role)} dashboard`} description={`Signed in as ${user.fullName}`}>
      <BfcacheGuard />
      <DashboardSections
        sections={sections}
        footers={{
          "My event requests": (
            <Link
              href="/my-event-requests"
              className="inline-flex items-center gap-1 self-start text-sm font-semibold text-fg-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              My event requests
              <ChevronRight aria-hidden="true" className="size-4" />
            </Link>
          ),
        }}
      />
    </PageFrame>
  );
}
