import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ReviewQueue } from "@/components/ReviewQueue";

export const metadata = { title: "Event requests · ConnectSphere" };

export default function ReviewQueuePage() {
  return (
    <>
      <header className="dash__bar">
        <Logo />
        <Link href="/dashboard/event_coordinator" className="text-sm underline">
          Back to dashboard
        </Link>
      </header>
      <main className="mx-auto w-full max-w-5xl p-6">
        <h1 className="mb-4 text-2xl font-semibold">Review event requests</h1>
        <ReviewQueue />
      </main>
    </>
  );
}
