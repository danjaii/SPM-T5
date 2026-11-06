import type { Metadata } from "next";
import { MyEventRequestsList } from "@/components/MyEventRequestsList";
import { PageFrame } from "@/components/PageFrame";
import { getMyEventRequests } from "@/lib/myEventRequestsServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "My event requests · ConnectSphere" };

// SCRUM-52: an organiser tracks every event request they created. event-service answers only for organisers and RLS limits the rows to theirs.
// SCRUM-159/AC2: the same page in the new design, inside the shared app shell. SCRUM-186/AC2: a sidebar page, so no back link.
export default async function MyEventRequestsPage() {
  const result = await getMyEventRequests();

  return (
    <PageFrame title="My event requests">
      <MyEventRequestsList result={result} />
    </PageFrame>
  );
}
