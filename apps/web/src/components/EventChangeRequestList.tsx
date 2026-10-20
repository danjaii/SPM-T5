import Link from "next/link";
import { CHANGE_REQUEST_REVIEW_MESSAGES } from "@spm-t5/shared";
import { EmptyNote, EventSection } from "@/components/event/EventSection";
import { InlineMessage } from "@/components/event/InlineMessage";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ChangeRequestView } from "@/lib/events";

const STATUS_LABELS: Record<ChangeRequestView["status"], string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

const formatRequestedAt = (iso: string) =>
  new Date(iso).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" });

// SCRUM-66/AC7: each change request the organiser has made, with whether it is pending, approved or rejected.
// SCRUM-67/AC1: for the event's assigned coordinator (`reviewable`), a notice when one awaits their review, and a link to
// review each.
export function EventChangeRequestList({ requests, reviewable = false }: { requests: ChangeRequestView[]; reviewable?: boolean }) {
  return (
    <EventSection id="change-requests" title="Change requests">
      {reviewable && requests.some((r) => r.status === "pending") && (
        <InlineMessage kind="warning">{CHANGE_REQUEST_REVIEW_MESSAGES.awaitingReview}</InlineMessage>
      )}
      {requests.length === 0 ? (
        <EmptyNote>No change requests yet.</EmptyNote>
      ) : (
        <ul className="flex flex-col gap-3">
          {requests.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 rounded-lg border border-border p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <EventChangeRequestBadge status={r.status} />
                <span className="text-xs text-muted-foreground">({formatRequestedAt(r.requested_at)})</span>
                {reviewable && (
                  <Link className={cn(buttonVariants({ variant: "outline", size: "xs" }))} href={`/change-requests/${r.id}`}>Review</Link>
                )}
              </div>
              <p>{r.change_description}</p>
              {r.status === "rejected" && r.review_notes && <p className="text-muted-foreground">{r.review_notes}</p>}
            </li>
          ))}
        </ul>
      )}
    </EventSection>
  );
}

function EventChangeRequestBadge({ status }: { status: ChangeRequestView["status"] }) {
  const tone = status === "approved" ? "success" : status === "rejected" ? "danger" : "info";
  return <StatusBadge tone={tone} label={STATUS_LABELS[status] ?? status} />;
}
