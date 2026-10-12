import { Badge } from "@/components/ui/badge";

const LABELS: Record<string, string> = {
  approved: "Approved",
  rejected: "Rejected",
  submitted: "Submitted",
  under_review: "Under Review",
  returned: "Returned",
  planning: "Planning",
  awaiting_arrangements: "Awaiting Arrangements",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
  draft: "Draft",
};

export const statusLabel = (status: string) => LABELS[status] ?? status;

const VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  submitted: "secondary",
  under_review: "secondary",
  approved: "default",
  confirmed: "default",
  rejected: "destructive",
  cancelled: "destructive",
};

interface Props {
  status: string;
}

export default function EventStatusBadge({ status }: Props) {
  return <Badge variant={VARIANTS[status] ?? "outline"}>{statusLabel(status)}</Badge>;
}
