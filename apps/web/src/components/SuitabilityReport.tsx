import type { CriterionStatus } from "@spm-t5/shared";
import { Check, CircleHelp, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import type { SuitabilityView } from "@/lib/venueSuitability";

// SCRUM-109: the result of the suitability check. Every line says its status in words (not colour alone) and
// "Check manually" lists the free-text requirements nobody can compare automatically.
const STATUS_LABEL: Record<CriterionStatus, string> = {
  met: "Met",
  not_met: "Not met",
  not_checked: "Not checked",
  manual: "Check manually",
};

// SCRUM-132/AC2, AC6: each line has an icon as well as its words, and the summary is a StatusBadge.
const STATUS_ICON: Record<CriterionStatus, { Icon: LucideIcon; className: string }> = {
  met: { Icon: Check, className: "text-status-success-fg" },
  not_met: { Icon: X, className: "text-destructive" },
  not_checked: { Icon: CircleHelp, className: "text-muted-foreground" },
  manual: { Icon: TriangleAlert, className: "text-status-warning-fg" },
};

function StatusIcon({ status }: { status: CriterionStatus }) {
  const { Icon, className } = STATUS_ICON[status];
  return <Icon aria-hidden="true" className={`size-4 shrink-0 ${className}`} />;
}

type Report = Pick<SuitabilityView, "overall" | "criteria" | "manualChecks"> & { venue?: { name: string } };

export function SuitabilityReport({ report }: { report: Report }) {
  const suitable = report.overall === "suitable";
  return (
    <section className="suitability" aria-label="Venue suitability">
      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground" role="status">
        {report.venue ? `${report.venue.name}:` : null}
        <StatusBadge tone={suitable ? "success" : "danger"} label={suitable ? "Suitable" : "Not suitable"} />
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {report.criteria.map((c) => (
          <li key={c.key} data-status={c.status} className="text-sm">
            <span className="flex items-center gap-1.5">
              <StatusIcon status={c.status} />
              <strong>{c.label}</strong> <span>{STATUS_LABEL[c.status]}</span>
            </span>
            <div className="text-muted-foreground">{c.message}</div>
          </li>
        ))}
      </ul>
      {report.manualChecks.length > 0 && (
        <>
          <h3>Check manually</h3>
          <ul>
            {report.manualChecks.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
