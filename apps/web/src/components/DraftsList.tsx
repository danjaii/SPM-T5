import { FileText } from "lucide-react";
import Link from "next/link";
import { AuthAlert } from "@/components/auth/AuthParts";
import { MyEventRequestsTable } from "@/components/MyEventRequestsTable";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { isDraft, type MyEventRequest } from "@/lib/myEventRequests";

/** SCRUM-124/AC2: only the organiser's drafts, or why the list could not load, or that there are none. */
export function DraftsList({ result }: { result: { requests: MyEventRequest[] } | { error: string } }) {
  if ("error" in result) return <AuthAlert tone="error">{result.error}</AuthAlert>;

  const drafts = result.requests.filter(isDraft);
  if (drafts.length === 0) {
    return (
      <div data-state="empty" className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-strong px-6 py-10 text-center">
        <FileText aria-hidden="true" className="size-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">You have no drafts.</p>
        <Link href="/events/new" className={buttonVariants({ variant: "outline" })}>Start a new event request</Link>
      </div>
    );
  }

  return (
    <Card className="gap-4 p-2 sm:p-4">
      <MyEventRequestsTable requests={drafts} />
    </Card>
  );
}
