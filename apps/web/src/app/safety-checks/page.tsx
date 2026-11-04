import type { Metadata } from "next";
import { PageFrame } from "@/components/PageFrame";
import { SafetyCheckQueue } from "@/components/SafetyCheckQueue";
import { getSafetyQueue } from "@/lib/safetyCheckServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Safety checks · ConnectSphere" };

// SCRUM-99/AC2: the Safety Officer's list of events ready for an Operational Safety Check. SCRUM-142/AC1: inside the shared
// app shell, whose "Safety checks" item shows the same count. SCRUM-186/AC4: titled as the sidebar names it.
export default async function SafetyCheckQueuePage() {
  const result = await getSafetyQueue();

  return (
    <PageFrame
      title="Safety checks"
      description="Events waiting for a safety check. Open one to review its six factors and record your decision."
      error={"events" in result ? undefined : result.error}
    >
      {"events" in result && <SafetyCheckQueue events={result.events} />}
    </PageFrame>
  );
}
