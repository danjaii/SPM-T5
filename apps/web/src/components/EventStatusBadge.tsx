const LABELS: Record<string, string> = {
  approved: "Approved",
  rejected: "Rejected",
  submitted: "Submitted",
  under_review: "Under Review",
  planning: "Planning",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
  draft: "Draft",
};

interface Props {
  status: string;
}

export default function EventStatusBadge({ status }: Props) {
  return <span>{LABELS[status] ?? status}</span>;
}
