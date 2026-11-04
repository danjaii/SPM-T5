import type { Metadata } from "next";
import { AuthAlert } from "@/components/auth/AuthParts";
import { SafetyCheckQueue } from "@/components/SafetyCheckQueue";
import { getSafetyQueue } from "@/lib/safetyCheckServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Events waiting for a safety check · ConnectSphere" };

// SCRUM-99/AC2: the Safety Officer's list of events ready for an Operational Safety Check. SCRUM-142/AC1: inside the shared
// app shell, whose "Safety checks" item shows the same count.
export default async function SafetyCheckQueuePage() {
  const result = await getSafetyQueue();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">
      <h1 className="mb-1 text-3xl font-bold tracking-tight text-foreground">Events waiting for a safety check</h1>
      <p className="mb-6 text-sm text-muted-foreground">Open one to review its six factors and record your decision.</p>
      {"events" in result ? <SafetyCheckQueue events={result.events} /> : <AuthAlert tone="error">{result.error}</AuthAlert>}
    </main>
  );
}
