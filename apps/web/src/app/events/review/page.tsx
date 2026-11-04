import { PageFrame } from "@/components/PageFrame";
import { ReviewQueue } from "@/components/ReviewQueue";

export const metadata = { title: "Event requests · ConnectSphere" };

// Same frame (width, padding, title) as the dashboard; the sidebar's Home item replaces the old "Back to dashboard" link.
export default function ReviewQueuePage() {
  return (
    <PageFrame title="Event requests" description="Review the event requests assigned to you.">
      <ReviewQueue />
    </PageFrame>
  );
}
